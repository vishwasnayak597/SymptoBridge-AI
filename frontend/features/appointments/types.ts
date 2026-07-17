export interface Appointment {
  _id: string;
  doctor: {
    _id: string;
    firstName: string;
    lastName: string;
    specialization: string;
    consultationFee: number;
    avatar?: string;
  };
  appointmentDate: string;
  consultationType: string;
  symptoms: string;
  status: string;
  fee: number;
  videoCallLink?: string;
  createdAt: string;
  forDependent?: { name: string; relation: string };
  rating?: {
    patientRating?: number;
    patientReview?: string;
    doctorRating?: number;
    doctorReview?: string;
  };
}
