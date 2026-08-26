# Volume 4 — The ML Service

774 lines of Python across six files: a knowledge base of clinical priors, a synthetic
data generator, a training script, an inference engine, and a FastAPI surface. This is
the part of the system that makes an actual clinical determination, and it is
deliberately **not** an LLM wrapper.

Pipeline: `knowledge.py` (priors) → `generate_synthetic.py` (sampled cases) →
`train.py` (fit + evaluate) → `model.pkl` → `engine.py` (inference) → `app.py` (HTTP).

---

## 1. `knowledge.py` — the clinical priors

[`ml-service/knowledge.py`](../../ml-service/knowledge.py) · 171 lines.

Two dictionaries and a couple of defaults. `SYMPTOMS` maps each symptom id to its
patient-facing question:

```python
SYMPTOMS: dict[str, str] = {
    "fever": "Do you have a fever?",
    "chest_pain_radiating": "Does the chest pain spread to your arm, jaw, or back?",
    "burning_urination": "Does it burn when you urinate?",
    ...
}
```

This single table does triple duty: it defines the model's **feature vocabulary**, it
supplies the **question text** the UI renders (returned via `/meta`, cached in
`TriageService`), and its underscore-separated ids are what `extractInitialFindings`
token-matches against free text (Volume 2 §6). That coupling is why symptom ids read as
natural phrases — `back_pain`, `shortness_of_breath` — rather than codes.

Note the granularity choices: `fever` and `high_fever` are separate features, as are
`cough`, `dry_cough` and `productive_cough`, and `chest_pain` / `chest_pain_exertion` /
`chest_pain_radiating`. Splitting a symptom into severity and qualifier variants is what
gives the information-gain step something discriminating to ask about — "do you have
chest pain" separates far less than "does it spread to your arm or jaw".

`DISEASES` holds 19 conditions, each with `specialization`, `urgency`, and a `symptoms`
map of conditional probabilities:

```python
DISEASES: dict[str, dict] = {
    "Pneumonia": { "specialization": "Pulmonology", "urgency": "high",
                   "symptoms": { "fever": 0.9, "productive_cough": 0.8, ... } },
    ...
}
```

The values are `P(symptom | disease)`. `specialization` is what the triage result routes
the patient to; `urgency` (`low`/`medium`/`high`/`urgent`) drives the stopping policy and
the banner. `BASE_RATE` is the fallback probability for symptoms a disease does not list,
and `DEFAULT_SPECIALIZATION` / `DEFAULT_URGENCY` cover diseases present in an external
dataset but absent from this table.

The module docstring is unusually honest and worth preserving verbatim in any writeup:
these are *coarse, education-grade priors, not clinical truth*, and the model is trained
from sampled data rather than reading this table at inference time. That distinction is
the difference between "I encoded a lookup table" and "I built a trained probabilistic
model" — and only the second is true here.

---

## 2. `data/generate_synthetic.py` — materialising the priors

[`ml-service/data/generate_synthetic.py`](../../ml-service/data/generate_synthetic.py) · 61 lines.

```python
for disease, meta in knowledge.DISEASES.items():
    probs = meta["symptoms"]
    for _ in range(per_disease):
        row = {}
        for s in symptoms:
            p = probs.get(s, knowledge.BASE_RATE)
            row[s] = int(rng.random() < p)
        if sum(row.values()) == 0:
            core = max(probs, key=probs.get)
            row[core] = 1
        row["prognosis"] = disease
        rows.append(row)
```

Straight Bernoulli sampling: for each of `per_disease` cases (default 400), draw every
symptom independently against its conditional probability. Symptoms the disease does not
list fall back to `BASE_RATE`, which is what produces realistic background noise — a flu
case occasionally reporting an unrelated symptom.

The `sum(row.values()) == 0` guard forces the most probable symptom on when a draw
produces an entirely empty case. Without it the dataset would contain all-zero feature
vectors labelled with a disease, which teaches the model that "no symptoms" is evidence
*for* whichever disease happened to generate the most empty rows.

`rng = np.random.default_rng(seed)` with a fixed default seed makes the whole dataset
reproducible — the same build produces the same model, which matters when the training
step runs inside a Docker build. The final `.sample(frac=1.0)` shuffles so the rows are
not grouped by label.

The independence assumption baked in here is the same one Naive Bayes makes downstream,
so the generator and the model agree by construction. That is a real caveat to state
plainly: sampling from independent priors and then fitting a model that assumes
independence means the synthetic evaluation numbers are optimistic relative to real
patients, where symptoms correlate.

---

## 3. `train.py` — fit, benchmark, persist

[`ml-service/train.py`](../../ml-service/train.py) · 175 lines. Runs at Docker build time,
so the deployed image ships with `model.pkl` already built.

**`load_data(per_disease)`** prefers real data: if `data/Training.csv` exists (the Kaggle
disease-symptom dataset) it loads and concatenates `Testing.csv`, strips the stray
`Unnamed:` columns and all-NaN columns that dataset ships with, and derives question text
from `knowledge.SYMPTOMS` with a `humanize()` fallback that turns `joint_pain` into "Do
you have joint pain?". Otherwise it falls back to the synthetic generator. Either way it
returns a dataframe with a `prognosis` label column plus a `source` tag that is recorded
in the metrics — so you can always tell which data a given model was trained on.

**`inject_noise(X, rate)`** flips each symptom bit with probability `rate` (default 0.05):

```python
flips = rng.random(X.shape) < rate
return np.where(flips, 1 - X, X)
```

This is deliberate label-preserving corruption, simulating patients who misreport or
forget symptoms. Training on noise-free data would produce a model that is confident and
brittle; 5% flips force it to tolerate imperfect evidence. It is applied *before* the
train/test split, so both sides are equally noisy and the reported accuracy reflects
realistic conditions.

**The split** uses `stratify=y`, keeping every disease proportionally represented in the
test set — necessary with 19 classes, where a random split could otherwise leave a rare
condition entirely out of evaluation.

**The served model** is `BernoulliNB(alpha=1.0)`. `alpha` is Laplace smoothing: it
prevents any `P(symptom | disease)` from being exactly 0 or 1, which would make a single
contradicting observation drive the posterior to zero and be unrecoverable. This
complements the `EPS` clamp in the engine (§4).

The choice of Naive Bayes over a stronger classifier is the central architectural
decision, and the docstring states the reason precisely: NB's parameters let the API
compute a posterior over **partial** evidence and the **information gain** of each
unobserved symptom. A random forest can classify a complete feature vector but cannot
answer "given these three symptoms, which fourth question would most reduce my
uncertainty" — and that capability *is* the product. This is an excellent interview
answer: the model was chosen for its inference properties, not its leaderboard score.

**Comparators** are trained purely to justify that choice: a `RandomForestClassifier`
(200 trees) and an `MLPClassifier` (64 hidden units). Their accuracy and top-3 accuracy
are recorded in the metrics but they are never served — the file labels them "benchmark
only, not served".

**Evaluation** captures four numbers for the NB model:

- `accuracy` — top-1 correctness.
- `top3_accuracy` — via `top_k_accuracy`, using `np.argsort(proba)[:, -k:]`. This is the
  honest metric for differential diagnosis: surfacing the right condition in a ranked
  shortlist of three is the actual clinical goal, not picking one winner.
- `macro_f1` — averaged per class, so a rare disease counts as much as a common one.
- `brier_score` — mean one-vs-rest squared error between predicted probability and
  outcome. This measures **calibration**, not just ranking: it asks whether a stated 70%
  actually means 70%. Including it is the mark of someone who understands that a triage
  UI *displays* probabilities, so those probabilities have to be trustworthy, not merely
  correctly ordered.

**Persistence** stores the raw NB parameters rather than a pickled sklearn estimator:

```python
model = {
    "classes": classes,
    "symptoms": symptoms,
    "class_log_prior": nb.class_log_prior_.tolist(),
    "feature_log_prob": nb.feature_log_prob_.tolist(),
    "questions": questions,
    "disease_meta": {c: disease_meta(c) for c in classes},
    "metrics": metrics,
}
```

Two payoffs. First, the serving path needs **no sklearn at runtime** — `engine.py` is
pure NumPy, which keeps the container small and eliminates a version-compatibility class
of bug (unpickling an estimator across sklearn versions is a known failure mode). Second,
the parameters are exactly what the partial-evidence math needs. `disease_meta` is
resolved case-insensitively against `knowledge.DISEASES` so a Kaggle label like
"pneumonia" still finds its specialization. `model_meta.json` is written alongside as a
human-readable model card.

---

## 4. `engine.py` — inference

[`ml-service/engine.py`](../../ml-service/engine.py) · 163 lines, pure NumPy, no web
framework — which is what makes it unit-testable in isolation
([`tests/test_engine.py`](../../ml-service/tests/test_engine.py)).

### Construction

```python
p_present = np.exp(np.asarray(model["feature_log_prob"], dtype=float))
self.p_present = np.clip(p_present, EPS, 1 - EPS)   # (n_classes, n_symptoms)
```

sklearn stores log-probabilities; the engine exponentiates once at load. The `clip` to
`[1e-6, 1-1e-6]` is what makes **absence** usable: computing `log(1 - p)` for a symptom
with `p = 1.0` would be `log(0) = -inf` and annihilate that disease permanently. Combined
with Laplace smoothing at training time, this is belt-and-braces against degenerate
likelihoods.

`sym_idx` is a name→column lookup so evidence dictionaries can be applied by symptom id.

### `_clean_evidence`

Filters to symptoms the model actually knows and coerces to strict 0/1, dropping
`None`. Defensive at the boundary: the client controls this dictionary, and an unknown key
or a `2` would otherwise index out of range or corrupt the arithmetic.

### `posterior(evidence)` — the Bayesian update

```python
logp = self.log_prior.copy()
for s, val in ev.items():
    col = self.p_present[:, j]
    logp += np.log(col if val == 1 else (1.0 - col))
logp -= logp.max()
post = np.exp(logp)
return post / post.sum()
```

Formally:

```
log P(d | E) ∝ log P(d) + Σ_{s∈E} [ s=1 ? log P(s|d) : log(1 − P(s|d)) ]
```

Working in log-space turns a product of many small probabilities into a sum, avoiding
float underflow. The `logp -= logp.max()` before `exp` is the log-sum-exp trick: it
shifts the largest value to 0 so `exp` cannot overflow, and since the shift is a constant
factor it cancels in the normalisation. Each symptom's column is a vector over all
diseases, so one loop iteration updates every hypothesis at once — the whole function is
O(|evidence| × n_classes) with no Python-level inner loop.

The `else (1.0 - col)` branch is what makes this a full Bernoulli likelihood rather than
presence-counting. A "no" answer is genuine evidence: reporting *no* fever meaningfully
lowers pneumonia. Systems that only accumulate positive findings throw that away.

### `info_gain(post, symptom)` — the question-selection objective

```python
p_yes = float(np.dot(post, col))
h_before = _entropy(post)
yes = post * col;  no = post * (1.0 - col)
yes /= yes.sum();  no /= no.sum()
h_after = p_yes * _entropy(yes) + p_no * _entropy(no)
return max(0.0, h_before - h_after)
```

```
H(p)  = −Σ pᵢ log₂ pᵢ
IG(s) = H(post) − [ p_yes·H(post | s=1) + (1−p_yes)·H(post | s=0) ]
```

`p_yes = post · P(s|·)` is the marginal likelihood of a "yes" under current beliefs — the
model's own prediction of the answer. Both hypothetical posteriors are computed, their
entropies weighted by how likely each answer is, and the expected remaining uncertainty
subtracted from the current uncertainty. The result is in **bits**: literally how much
information this question is expected to buy.

`max(0.0, ...)` guards floating-point noise, since information gain is non-negative in
theory.

`_entropy` filters `p[p > 0]` before taking logs, because `0·log 0` is defined as 0 in
information theory but NaN in floating point.

`next_question` (line 88) scans every un-asked, un-skipped symptom and returns the
argmax. This is the greedy one-step-lookahead policy — optimal per question, not
globally optimal over a whole sequence, which is the standard and entirely defensible
trade-off (full lookahead is exponential).

### Stopping and presentation

`should_stop(asked, post, top)` fires on any of three conditions: eight questions asked,
top condition ≥ 0.70, or a `high`/`urgent` condition ≥ 0.45. The asymmetry is a clinical
safety bias — the system stops early and escalates when something dangerous is merely
*plausible*, rather than waiting for the confidence it would demand before declaring a
benign condition.

`overall_urgency(top)` takes the worst urgency among conditions above a 0.15 probability
floor, so a long-tail urgent label at 2% cannot redden the whole result.

`top_conditions(post, n=6)` sorts descending, rounds to 4 decimals, and joins each
disease with its specialization and urgency from `disease_meta`.

`step(evidence, skip)` composes all of it into one response: posterior, next question (or
`None` when done), `done`, `urgency`, up to three deduplicated `recommendedSpecializations`
in probability order, and `askedCount`. Note `asked = len(ev) + len(skip_set)` — skipped
questions count toward the budget, so a user answering "not sure" to everything still
terminates.

---

## 5. `app.py` — the HTTP surface

[`ml-service/app.py`](../../ml-service/app.py) · 110 lines of FastAPI.

**Lazy model loading:**

```python
def get_model() -> Optional[TriageModel]:
    global _model
    if _model is None:
        try:
            _model = TriageModel.load(MODEL_PATH)
        except FileNotFoundError:
            return None
    return _model
```

Loaded on first use and memoised, not at import. The service therefore **boots and serves
`/health` even with no trained model**, reporting `model_loaded: false` — so a deployment
where training failed is diagnosable rather than a crash loop. Every endpoint degrades to
`{"error": "model_not_trained"}` instead of throwing.

**Endpoints:**

- `GET /health` — liveness plus `model_loaded`. This is what `KeepAliveService` pings.
- `GET /meta` — the model card: every symptom with its question, every disease with
  specialization and urgency, and the full training metrics. `TriageService` caches this
  for process lifetime, and it is what lets the frontend render questions without
  hardcoding any medical content.
- `POST /predict` — posterior only, for a one-shot ranking.
- `POST /next-question` — the full `step()`. This is the endpoint the triage wizard drives,
  called once to start and once per answer.

**Request model:**

```python
class Evidence(BaseModel):
    evidence: dict[str, int] = {}
    skip: list[str] = []
```

Pydantic validates and coerces; both fields default to empty so a bare `POST` is a valid
"start from nothing" call. `skip` carries symptoms the user answered "not sure" to, so
they are excluded from re-asking without being recorded as absent — a meaningful third
state that a plain yes/no evidence dict cannot express.

**Metrics middleware** wraps every request in a Prometheus `Histogram` labelled by
method, path and status, excluding `/metrics` itself to avoid self-measurement. Since
FastAPI paths here are static (no path parameters), label cardinality is naturally bounded
— the same concern the Node service handles by using route templates (Volume 1 §11).

**CORS is `allow_origins=["*"]`.** Acceptable only because this service is called
server-to-server by the Node API and exposes no user data or mutations — but it does mean
anyone who discovers the URL can query the model directly. A shared secret between the
two services would close that.

**Statelessness** is the deliberate design: the client (via the Node API) carries the
accumulated evidence and resends it every turn. The ML service holds no session, so it
scales horizontally with zero coordination and a restart mid-triage loses nothing.

---

## 6. Honest assessment

**What is genuinely strong.** A real trained probabilistic model with a defensible
architecture choice; information-theoretic question selection implemented from the maths
rather than pulled from a library; calibration measured (Brier) not just accuracy;
benchmarked against two alternatives; reproducible seeded training; the serving path free
of sklearn; and a clean separation where the LLM never touches the diagnosis.

**What to state plainly rather than oversell.** The priors are hand-authored and
education-grade. When Kaggle CSVs are absent, the model trains on data sampled from
independent priors and is then fit with an independence assumption — so evaluation
numbers flatter it relative to real patients with correlated symptoms. Nineteen
conditions is a demonstration vocabulary, not clinical coverage. And
`extractInitialFindings` upstream is string matching, so the quality of the initial
evidence is the weakest link in the chain.

**The two highest-value improvements.** A deterministic red-flag rule layer *above* the
probabilistic model, so emergency presentations escalate by rule rather than by
posterior — which is how real clinical decision support is built. And a resilience
boundary on the Node side (`mlFetch` has no timeout or circuit breaker), since a cold
container currently stalls the caller.

---

## Next

Volume 5 covers the frontend core — the API client, React Query configuration, auth
context, and the hooks the screens are built from.
