import React, { useState, useEffect , useRef} from 'react';
import { apiClient } from '../lib/api';
import TriageWizard from './TriageWizard';
import {
  MicrophoneIcon,
  StopIcon,
  SpeakerWaveIcon,
  HeartIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  MapPinIcon,
  UserGroupIcon,
  SparklesIcon,
  ArrowRightIcon,
  ChatBubbleLeftEllipsisIcon
} from '@heroicons/react/24/outline';

interface SymptomAnalysis {
  severity: 'low' | 'medium' | 'high' | 'urgent';
  possibleConditions: string[];
  recommendations: string[];
  urgencyLevel: string;
  nextSteps: string[];
  disclaimer: string;
  confidence?: number;
}

interface SymptomCheckerProps {
  onFindDoctors?: (symptoms: string, recommendedSpecializations?: string[]) => void;
  onBookAppointment?: (urgency: string, recommendedSpecializations?: string[]) => void;
}

const SEVERITY_COLORS = {
  low: 'text-green-600 bg-green-50 border-green-200',
  medium: 'text-yellow-600 bg-yellow-50 border-yellow-200', 
  high: 'text-orange-600 bg-orange-50 border-orange-200',
  urgent: 'text-red-600 bg-red-100 border-red-400 shadow-lg ring-2 ring-red-200'
};

const SEVERITY_ICONS = {
  low: CheckCircleIcon,
  medium: ClockIcon,
  high: ExclamationTriangleIcon,
  urgent: ExclamationTriangleIcon
};

const SymptomChecker: React.FC<SymptomCheckerProps> = ({ 
  onFindDoctors,
  onBookAppointment 
}) => {
  const [symptoms, setSymptoms] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<SymptomAnalysis | null>(null);
  const [recommendedDoctors, setRecommendedDoctors] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<Array<{
    type: 'user' | 'ai';
    content: string;
    timestamp: Date;
  }>>([]);
  const [error, setError] = useState(''); // Added error state
  const [triageStarted, setTriageStarted] = useState(false); // new: trained-model sequential triage

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recognitionRef = useRef<any>(null);


  // Initialize speech recognition
  useEffect(() => {
    if (typeof window !== 'undefined' && 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = true;
      recognitionRef.current.interimResults = true;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        // Only append results that the engine has finalized. Interim results
        // fire repeatedly for the same words, so appending them here duplicated
        // the spoken text ("hi I am having hi I am having ...").
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript.trim()) {
          setSymptoms(prev => (prev ? prev + ' ' : '') + finalTranscript.trim());
        }
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const handleVoiceInput = async () => {
    if (!isListening && recognitionRef.current) {
      setIsListening(true);
      recognitionRef.current.start();
    } else if (isListening && recognitionRef.current) {
      setIsListening(false);
      recognitionRef.current.stop();
    }
  };

  const analyzeSymptoms = async () => {
    if (!symptoms.trim()) return;

    setIsAnalyzing(true);
    setError('');

    try {
      const token = localStorage.getItem('accessToken');
      if (!token) {
        throw new Error('Authentication required');
      }

      // NEW: Try MCP-based analysis first, fallback to original if needed
      let response;
      try {
        
        // Build request payload - only include non-null values to avoid validation errors
        const requestPayload: any = {
          symptoms: symptoms.trim(),
          useMCPTools: true
        };
        
        // Only add optional fields if they have valid values
        // TODO: Add age input in UI later
        // TODO: Add gender input in UI later  
        // TODO: Add medical history input in UI later
        
        
        // Use enhanced MCP endpoint with intelligent fallback (OpenAI → Local)
        response = await apiClient.post('/ai/symptom-checker-mcp', requestPayload);

        
        // Handle MCP response structure
        if (response.data.success && response.data.data) {
          const mcpData = response.data.data;
          
          setAnalysisResult({
            severity: mcpData.analysis.severity,
            possibleConditions: mcpData.analysis.possibleConditions,
            recommendations: mcpData.analysis.recommendations,
            urgencyLevel: mcpData.analysis.urgencyLevel,
            nextSteps: mcpData.analysis.nextSteps,
            confidence: mcpData.analysis.confidence,
            disclaimer: mcpData.analysis.warning || 'This is an AI-generated analysis. Please consult a healthcare provider for proper medical evaluation.'
          });

          // Set recommended doctors based on MCP specializations
          if (mcpData.analysis.recommendedSpecializations?.length > 0) {
            setRecommendedDoctors(mcpData.analysis.recommendedSpecializations);
          }

          // Show normalization info if available
          if (mcpData.normalization && mcpData.normalization.possibleTypos?.length > 0) {
          }

          // Show UI feedback about which AI method was used
          if (mcpData.meta?.uiFeedback) {
            const feedback = mcpData.meta.uiFeedback;
            if (feedback.fallbackUsed) {
              if (feedback.fallbackReason) {
              }
            } else {
            }
          }

          return; // Exit early on successful MCP analysis
        }
      } catch (mcpError) {
        console.warn('🎯 MCP analysis failed, falling back to original method:', mcpError);
        
        // Fallback to original combined API
        response = await apiClient.post('/ai/analyze-and-recommend', {
          symptoms: symptoms.trim(),
          location: 'General'
        });
      }

      // Handle original API response
      if (!response.data) {
        throw new Error('No response data received');
      }

      const data = response.data;
      
      if (!data.success) {
        throw new Error(data.error || 'Analysis failed');
      }

      // Extract analysis and doctor recommendations
      const analysisData = data.data?.analysis || data.data;
      const doctorsData = data.data?.doctors || data.data?.recommendedDoctors || [];

      setAnalysisResult(analysisData);
      
      if (Array.isArray(doctorsData) && doctorsData.length > 0) {
        setRecommendedDoctors(doctorsData);
      } else if (analysisData?.recommendedSpecializations?.length > 0) {
        setRecommendedDoctors(analysisData.recommendedSpecializations);
      }

    } catch (error: any) {
      console.error('Error analyzing symptoms:', error);
      setError(error.message || 'Failed to analyze symptoms. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const clearAnalysis = () => {
    setSymptoms('');
    setAnalysisResult(null);
    setRecommendedDoctors([]);
    setConversationHistory([]);
    setError(''); // Clear error on start over
  };

  const SeverityIcon = analysisResult ? SEVERITY_ICONS[analysisResult.severity] : CheckCircleIcon;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center mb-4 mx-auto">
          <SparklesIcon className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-2">AI Symptom Checker</h2>
        <p className="text-gray-600">Describe your symptoms and get AI-powered health insights</p>
      </div>

      {/* Symptom Input */}
      <div className="card">
        <div className="card-body">
          <label htmlFor="symptoms" className="block text-sm font-medium text-gray-700 mb-2">
            Describe your symptoms
          </label>
          <div className="relative">
            <textarea
              id="symptoms"
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              placeholder="Tell me what you're experiencing... (e.g., 'I have a headache and fever')"
              className="w-full h-32 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              disabled={isAnalyzing}
            />
            <button
              onClick={handleVoiceInput}
              className={`absolute bottom-3 right-3 p-2 rounded-lg transition-colors ${
                isListening 
                  ? 'bg-red-100 text-red-600 hover:bg-red-200' 
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              title={isListening ? 'Stop listening' : 'Start voice input'}
            >
              {isListening ? (
                <StopIcon className="h-5 w-5" />
              ) : (
                <MicrophoneIcon className="h-5 w-5" />
              )}
            </button>
          </div>
          
          {isListening && (
            <div className="mt-2 flex items-center text-red-600 text-sm">
              <div className="w-2 h-2 bg-red-600 rounded-full mr-2 animate-pulse"></div>
              Listening... Speak clearly
            </div>
          )}

          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => symptoms.trim() && setTriageStarted(true)}
              disabled={!symptoms.trim()}
              className="btn-primary flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <SparklesIcon className="h-4 w-4 mr-2" />
              Start AI Triage
            </button>

            <button
              onClick={analyzeSymptoms}
              disabled={!symptoms.trim() || isAnalyzing}
              className="btn-secondary flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? 'Analyzing...' : 'Classic analysis'}
            </button>

            {(symptoms || analysisResult || triageStarted) && (
              <button
                onClick={() => { clearAnalysis(); setTriageStarted(false); }}
                className="btn-secondary"
              >
                Clear & Start Over
              </button>
            )}
          </div>
        </div>
      </div>

      {/* New: trained-model sequential triage (live-narrowing differential) */}
      {triageStarted && (
        <TriageWizard
          symptoms={symptoms}
          onFindDoctors={onFindDoctors}
          onRestart={() => setTriageStarted(false)}
        />
      )}

      {/* AI Analysis Results (classic one-shot path) */}
      {!triageStarted && analysisResult && (
        <div className="space-y-6">
          {/* Severity Assessment */}
          <div className={`card border-2 ${SEVERITY_COLORS[analysisResult.severity]}`}>
            <div className="card-body">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center">
                  <SeverityIcon className="h-6 w-6 mr-3" />
                  <div>
                    <h3 className="text-lg font-semibold">Assessment Results</h3>
                    <p className="text-sm opacity-75">{analysisResult.urgencyLevel}</p>
                  </div>
                </div>
                {analysisResult.confidence && (
                  <div className="text-right">
                    <div className="text-sm font-medium">AI Confidence</div>
                    <div className="text-lg font-bold">{Math.round(analysisResult.confidence * 100)}%</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Emergency Warning Banner for Urgent Cases */}
          {analysisResult.severity === 'urgent' && (
            <div className="bg-red-600 text-white p-6 rounded-lg border-2 border-red-700 shadow-lg">
              <div className="flex items-center mb-4">
                <ExclamationTriangleIcon className="h-8 w-8 mr-3 animate-pulse" />
                <div>
                  <h3 className="text-xl font-bold">🚨 URGENT MEDICAL ATTENTION REQUIRED</h3>
                  <p className="text-red-100">Based on your symptoms, you need immediate medical care</p>
                </div>
              </div>
              <div className="bg-red-700 p-4 rounded-lg">
                <h4 className="font-semibold mb-2">IMMEDIATE ACTIONS:</h4>
                <ul className="space-y-1 text-sm">
                  <li>📞 Call emergency services (911) immediately</li>
                  <li>🏥 Go to nearest emergency room</li>
                  <li>🚗 Do NOT drive yourself - get help or call ambulance</li>
                  <li>💊 If chest pain: chew aspirin (if not allergic)</li>
                </ul>
              </div>
            </div>
          )}

          {/* Possible Conditions */}
          <div className="card">
            <div className="card-body">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Possible Conditions</h4>
              <ul className="space-y-2">
                {(analysisResult.possibleConditions || []).map((condition, index) => (
                  <li key={index} className="flex items-center">
                    <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                    <span className="text-gray-700">{condition}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Recommended Specializations */}
          {recommendedDoctors.length > 0 && (
            <div className="card border-l-4 border-l-purple-500">
              <div className="card-body">
                <h4 className="text-lg font-semibold text-gray-900 mb-3 flex items-center">
                  <SparklesIcon className="h-5 w-5 text-purple-500 mr-2" />
                  Recommended Doctor Specializations
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {recommendedDoctors.map((specialization, index) => (
                    <div key={index} className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                      <div className="flex items-center">
                        <div className="w-3 h-3 bg-purple-500 rounded-full mr-3"></div>
                        <span className="font-medium text-purple-900">{specialization}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-800">
                    💡 <strong>AI Recommendation:</strong> Based on your symptoms, these medical specializations would be most appropriate for consultation.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Recommendations */}
          <div className="card">
            <div className="card-body">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Recommendations</h4>
              <ul className="space-y-3">
                {(analysisResult.recommendations || []).map((recommendation, index) => (
                  <li key={index} className="flex items-start">
                    <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center mr-3 mt-0.5 flex-shrink-0">
                      <span className="text-green-600 text-xs font-semibold">{index + 1}</span>
                    </div>
                    <span className="text-gray-700">{recommendation}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Next Steps */}
          <div className="card">
            <div className="card-body">
              <h4 className="text-lg font-semibold text-gray-900 mb-3">Next Steps</h4>
              <ul className="space-y-3 mb-4">
                {(analysisResult.nextSteps || []).map((step, index) => (
                  <li key={index} className="flex items-start">
                    <ArrowRightIcon className="h-5 w-5 text-blue-500 mr-3 mt-0.5 flex-shrink-0" />
                    <span className="text-gray-700">{step}</span>
                  </li>
                ))}
              </ul>
              
              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-200">
                {onFindDoctors && (
                  <button
                    onClick={() => onFindDoctors(symptoms, recommendedDoctors)}
                    className="btn-primary flex items-center justify-center"
                  >
                    <HeartIcon className="h-4 w-4 mr-2" />
                    Find Nearby Doctors
                  </button>
                )}
                
                {onBookAppointment && (
                  <button
                    onClick={() => onBookAppointment(analysisResult.urgencyLevel, recommendedDoctors)}
                    className="btn-secondary flex items-center justify-center"
                  >
                    <ClockIcon className="h-4 w-4 mr-2" />
                    Book Appointment
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Disclaimer */}
          <div className="card bg-yellow-50 border border-yellow-200">
            <div className="card-body">
              <div className="flex items-start">
                <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 mr-3 mt-0.5 flex-shrink-0" />
                <div>
                  <h5 className="font-semibold text-yellow-800 mb-1">Important Disclaimer</h5>
                  <p className="text-yellow-700 text-sm">{analysisResult.disclaimer}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Conversation History */}
      {conversationHistory.length > 0 && (
        <div className="card">
          <div className="card-body">
            <h4 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <ChatBubbleLeftEllipsisIcon className="h-5 w-5 mr-2" />
              Conversation History
            </h4>
            <div className="space-y-3 max-h-60 overflow-y-auto">
              {conversationHistory.map((message, index) => (
                <div
                  key={index}
                  className={`flex ${message.type === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                      message.type === 'user'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    <p className="text-sm">{message.content}</p>
                    <p className={`text-xs mt-1 ${
                      message.type === 'user' ? 'text-blue-100' : 'text-gray-500'
                    }`}>
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SymptomChecker; 