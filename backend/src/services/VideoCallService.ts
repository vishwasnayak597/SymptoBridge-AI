import { v4 as uuidv4 } from 'uuid';

export interface VideoCallData {
  callId: string;
  callUrl: string;
  roomId: string;
  hostToken?: string;
  guestToken?: string;
  expiresAt: Date;
}

export interface VideoCallSession {
  callId: string;
  appointmentId: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  participants: Array<{
    userId: string;
    role: 'host' | 'guest';
    joinedAt?: Date;
    leftAt?: Date;
  }>;
  recording?: {
    enabled: boolean;
    recordingId?: string;
    recordingUrl?: string;
  };
}

export interface VideoCallProvider {
  name: 'agora' | 'twilio' | 'jitsi' | 'zoom' | 'mock';
  apiKey?: string;
  apiSecret?: string;
  appId?: string;
}

export class VideoCallService {
  private static provider: VideoCallProvider = {
    name: 'mock' // Default to mock for development
  };

  /**
   * Set video call provider configuration
   */
  static setProvider(provider: VideoCallProvider): void {
    this.provider = provider;
  }

  /**
   * Create a new video call session
   */
  static async createVideoCall(appointmentId: string): Promise<VideoCallData> {
    const callId = uuidv4();
    const roomId = `appointment_${appointmentId}_${Date.now()}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    switch (this.provider.name) {
      case 'agora':
        return await this.createAgoraCall(callId, roomId, expiresAt);
      case 'twilio':
        return await this.createTwilioCall(callId, roomId, expiresAt);
      case 'jitsi':
        return await this.createJitsiCall(callId, roomId, expiresAt);
      case 'zoom':
        return await this.createZoomCall(callId, roomId, expiresAt);
      case 'mock':
      default:
        return await this.createMockCall(callId, roomId, expiresAt, appointmentId);
    }
  }

  /**
   * Generate access token for video call
   */
  static async generateAccessToken(callId: string, userId: string, role: 'host' | 'guest'): Promise<string> {
    switch (this.provider.name) {
      case 'agora':
        return await this.generateAgoraToken(callId, userId, role);
      case 'twilio':
        return await this.generateTwilioToken(callId, userId, role);
      case 'jitsi':
        return await this.generateJitsiToken(callId, userId, role);
      case 'zoom':
        return await this.generateZoomToken(callId, userId, role);
      case 'mock':
      default:
        return await this.generateMockToken(callId, userId, role);
    }
  }

  /**
   * End video call session
   */
  static async endVideoCall(callId: string): Promise<VideoCallSession> {
    const session: VideoCallSession = {
      callId,
      appointmentId: 'mock',
      startTime: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      endTime: new Date(),
      duration: 30,
      participants: [
        {
          userId: 'doctor_id',
          role: 'host',
          joinedAt: new Date(Date.now() - 30 * 60 * 1000),
          leftAt: new Date()
        },
        {
          userId: 'patient_id',
          role: 'guest',
          joinedAt: new Date(Date.now() - 29 * 60 * 1000),
          leftAt: new Date()
        }
      ]
    };

    
    return session;
  }

  /**
   * Get call statistics
   */
  static async getCallStats(callId: string): Promise<{
    quality: 'poor' | 'fair' | 'good' | 'excellent';
    duration: number;
    participantCount: number;
    networkIssues: number;
  }> {
    // Mock implementation
    return {
      quality: 'good',
      duration: 30,
      participantCount: 2,
      networkIssues: 0
    };
  }

  /**
   * Get active video call for a specific patient
   */
  static async getActiveCallForPatient(patientId: string): Promise<any | null> {
    try {
      // Import here to avoid circular dependency issues
      const { Appointment } = await import('../models/Appointment');

      // A call only "rings" while it is actually live: the doctor started it
      // (videoCallId set) AND that happened recently. Using updatedAt — not the
      // appointment date — means a call that was never ended won't ring forever.
      const RING_WINDOW_MS = 60 * 60 * 1000; // 60 minutes
      const activeAppointment = await Appointment.findOne({
        patient: patientId,
        status: 'confirmed',
        consultationType: 'video',
        videoCallId: { $exists: true },
        updatedAt: { $gte: new Date(Date.now() - RING_WINDOW_MS) }
      })
      .populate('doctor', 'firstName lastName email')
      .populate('patient', 'firstName lastName email');

      if (!activeAppointment) {
        return null;
      }

      // Type cast the populated fields to access their properties
      const doctor = activeAppointment.doctor as any;
      const patient = activeAppointment.patient as any;

      return {
        appointmentId: activeAppointment._id,
        callId: activeAppointment.videoCallId,
        callUrl: activeAppointment.videoCallUrl,
        doctorName: `${doctor.firstName} ${doctor.lastName}`,
        appointmentDate: activeAppointment.appointmentDate.toLocaleString(),
        symptoms: activeAppointment.symptoms,
        specialization: activeAppointment.specialization
      };
    } catch (error) {
      console.error('Error getting active call for patient:', error);
      return null;
    }
  }

  // Mock implementation methods
  private static async createMockCall(callId: string, roomId: string, expiresAt: Date, appointmentId: string): Promise<VideoCallData> {
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const callUrl = `${baseUrl}/video-call/${appointmentId}`;


    return {
      callId,
      callUrl,
      roomId,
      expiresAt
    };
  }

  private static async generateMockToken(callId: string, userId: string, role: 'host' | 'guest'): Promise<string> {
    const token = `mock_${role}_${userId}_${callId}_${Date.now()}`;
    return token;
  }

  // Agora Video Call implementation
  private static async createAgoraCall(callId: string, roomId: string, expiresAt: Date): Promise<VideoCallData> {
    // TODO: Implement Agora Video Call creation
    // This would involve:
    // 1. Creating a channel in Agora
    // 2. Generating host and guest tokens
    // 3. Setting up recording if needed
    
    
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const callUrl = `${baseUrl}/video-call/agora/${callId}`;

    return {
      callId,
      callUrl,
      roomId,
      expiresAt,
      hostToken: await this.generateMockToken(callId, 'host', 'host'),
      guestToken: await this.generateMockToken(callId, 'guest', 'guest')
    };
  }

  private static async generateAgoraToken(callId: string, userId: string, role: 'host' | 'guest'): Promise<string> {
    // TODO: Implement Agora token generation using their SDK
    // Example:
    // const { RtcTokenBuilder, RtcRole } = require('agora-access-token');
    // const token = RtcTokenBuilder.buildTokenWithUid(
    //   this.provider.appId,
    //   this.provider.apiSecret,
    //   callId,
    //   userId,
    //   role === 'host' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
    //   Math.floor(Date.now() / 1000) + 3600
    // );
    
    return `agora_token_${role}_${userId}_${callId}`;
  }

  // Twilio Video implementation
  private static async createTwilioCall(callId: string, roomId: string, expiresAt: Date): Promise<VideoCallData> {
    // TODO: Implement Twilio Video room creation
    
    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const callUrl = `${baseUrl}/video-call/twilio/${callId}`;

    return {
      callId,
      callUrl,
      roomId,
      expiresAt
    };
  }

  private static async generateTwilioToken(callId: string, userId: string, role: 'host' | 'guest'): Promise<string> {
    // TODO: Implement Twilio access token generation
    return `twilio_token_${role}_${userId}_${callId}`;
  }

  // Jitsi Meet implementation
  private static async createJitsiCall(callId: string, roomId: string, expiresAt: Date): Promise<VideoCallData> {
    // Jitsi Meet is open source and doesn't require API calls for basic rooms
    const jitsiDomain = process.env.JITSI_DOMAIN || 'meet.jit.si';
    const callUrl = `https://${jitsiDomain}/${roomId}`;


    return {
      callId,
      callUrl,
      roomId,
      expiresAt
    };
  }

  private static async generateJitsiToken(callId: string, userId: string, role: 'host' | 'guest'): Promise<string> {
    // For Jitsi, tokens are usually JWT tokens if authentication is enabled
    return `jitsi_token_${role}_${userId}_${callId}`;
  }

  // Zoom implementation
  private static async createZoomCall(callId: string, roomId: string, expiresAt: Date): Promise<VideoCallData> {
    // TODO: Implement Zoom meeting creation using Zoom API
    
    return {
      callId,
      callUrl: `https://zoom.us/j/${roomId}`,
      roomId,
      expiresAt
    };
  }

  private static async generateZoomToken(callId: string, userId: string, role: 'host' | 'guest'): Promise<string> {
    // TODO: Implement Zoom JWT token generation
    return `zoom_token_${role}_${userId}_${callId}`;
  }

  /**
   * Validate video call session
   */
  static async validateCall(callId: string): Promise<boolean> {
    // In a real implementation, this would check if the call exists and is still valid
    return true;
  }

  /**
   * Record video call (if supported by provider)
   */
  static async startRecording(callId: string): Promise<{ recordingId: string; recordingUrl?: string }> {
    const recordingId = `rec_${callId}_${Date.now()}`;
    
    return {
      recordingId,
      recordingUrl: `https://recordings.example.com/${recordingId}`
    };
  }

  /**
   * Stop recording
   */
  static async stopRecording(callId: string, recordingId: string): Promise<{ recordingUrl: string; duration: number }> {
    
    return {
      recordingUrl: `https://recordings.example.com/${recordingId}`,
      duration: 1800 // 30 minutes in seconds
    };
  }

  /**
   * Send invitation to join video call
   */
  static async sendCallInvitation(callData: VideoCallData, participants: Array<{ email: string; role: 'host' | 'guest' }>): Promise<void> {
    for (const participant of participants) {
      
      // In production, this would send actual email invitations
    }
  }

  /**
   * Get supported video call features based on provider
   */
  static getSupportedFeatures(): {
    recording: boolean;
    screenShare: boolean;
    chat: boolean;
    whiteboard: boolean;
    breakoutRooms: boolean;
  } {
    switch (this.provider.name) {
      case 'zoom':
        return {
          recording: true,
          screenShare: true,
          chat: true,
          whiteboard: true,
          breakoutRooms: true
        };
      case 'agora':
        return {
          recording: true,
          screenShare: true,
          chat: true,
          whiteboard: false,
          breakoutRooms: false
        };
      case 'twilio':
        return {
          recording: true,
          screenShare: true,
          chat: false,
          whiteboard: false,
          breakoutRooms: false
        };
      case 'jitsi':
        return {
          recording: true,
          screenShare: true,
          chat: true,
          whiteboard: false,
          breakoutRooms: false
        };
      default:
        return {
          recording: false,
          screenShare: true,
          chat: true,
          whiteboard: false,
          breakoutRooms: false
        };
    }
  }
} 