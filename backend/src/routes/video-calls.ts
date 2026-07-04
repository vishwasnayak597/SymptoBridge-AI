import { Router, Request, Response } from 'express';
import { body, param, validationResult } from 'express-validator';
import { VideoCallService } from '../services/VideoCallService';
import { authenticate } from '../middleware/auth';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

const router = Router();

router.post('/', [
  authenticate,
  body('appointmentId').notEmpty().isMongoId()
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array().map(err => err.msg).join(', ') });
    }

    const { appointmentId } = req.body;
    const userId = req.user!._id.toString();

    // Create video call
    const callData = await VideoCallService.createVideoCall(appointmentId);

    // Update appointment status to 'confirmed' so patient knows doctor started the call
    const { Appointment } = await import('../models/Appointment');
    const appointment = await Appointment.findByIdAndUpdate(appointmentId, {
      status: 'confirmed',
      videoCallId: callData.callId,
      videoCallUrl: callData.callUrl
    }, { new: true });

    // Instant ring: push to the patient's socket room (polling remains as fallback)
    if (appointment) {
      const { SocketService } = await import('../services/SocketService');
      SocketService.emitToUser(appointment.patient.toString(), 'call:ring', {
        appointmentId,
        doctorName: `${req.user!.firstName} ${req.user!.lastName}`,
        appointmentDate: appointment.appointmentDate,
      });
    }

    const { publishEvent } = await import('../services/EventBus');
    publishEvent({
      type: 'call.started',
      actorId: userId,
      entityType: 'appointment',
      entityId: appointmentId,
      payload: { callId: callData.callId }
    });

    res.status(201).json({ success: true, data: callData, message: 'Video call created successfully' });
  } catch (error) {
    console.error('Error creating video call:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to create video call' });
  }
});

router.post('/:callId/token', [
  authenticate,
  param('callId').notEmpty(),
  body('role').isIn(['host', 'guest'])
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, error: errors.array().map(err => err.msg).join(', ') });
    }

    const token = await VideoCallService.generateAccessToken(req.params.callId, req.user!._id.toString(), req.body.role);
    res.json({ success: true, data: { token }, message: 'Access token generated successfully' });
  } catch (error) {
    console.error('Error generating access token:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to generate access token' });
  }
});

router.post('/:callId/end', [authenticate, param('callId').notEmpty()], async (req: Request, res: Response) => {
  try {
    const session = await VideoCallService.endVideoCall(req.params.callId);

    const { publishEvent } = await import('../services/EventBus');
    publishEvent({
      type: 'call.ended',
      actorId: req.user!._id.toString(),
      entityType: 'call',
      entityId: req.params.callId
    });

    res.json({ success: true, data: session, message: 'Video call ended successfully' });
  } catch (error) {
    console.error('Error ending video call:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to end video call' });
  }
});

router.get('/:callId/stats', [authenticate, param('callId').notEmpty()], async (req: Request, res: Response) => {
  try {
    const stats = await VideoCallService.getCallStats(req.params.callId);
    res.json({ success: true, data: stats, message: 'Call statistics retrieved successfully' });
  } catch (error) {
    console.error('Error fetching call stats:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to fetch call statistics' });
  }
});

router.get('/:callId/validate', [authenticate, param('callId').notEmpty()], async (req: Request, res: Response) => {
  try {
    const isValid = await VideoCallService.validateCall(req.params.callId);
    res.json({ success: true, data: { isValid }, message: 'Call validation completed' });
  } catch (error) {
    console.error('Error validating call:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to validate call' });
  }
});

router.post('/:callId/recording/start', [authenticate, param('callId').notEmpty()], async (req: Request, res: Response) => {
  try {
    const recording = await VideoCallService.startRecording(req.params.callId);
    res.json({ success: true, data: recording, message: 'Recording started successfully' });
  } catch (error) {
    console.error('Error starting recording:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to start recording' });
  }
});

router.post('/:callId/recording/:recordingId/stop', [
  authenticate,
  param('callId').notEmpty(),
  param('recordingId').notEmpty()
], async (req: Request, res: Response) => {
  try {
    const recording = await VideoCallService.stopRecording(req.params.callId, req.params.recordingId);
    res.json({ success: true, data: recording, message: 'Recording stopped successfully' });
  } catch (error) {
    console.error('Error stopping recording:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to stop recording' });
  }
});

router.get('/features', async (req: Request, res: Response) => {
  try {
    const features = VideoCallService.getSupportedFeatures();
    res.json({ success: true, data: features, message: 'Supported features retrieved successfully' });
  } catch (error) {
    console.error('Error fetching features:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to fetch features' });
  }
});

// Get active video calls for current patient
router.get('/active', [authenticate], async (req: Request, res: Response) => {
  try {
    const userId = req.user!._id.toString();
    const userRole = req.user!.role;

    // Only patients can check for active calls
    if (userRole !== 'patient') {
      return res.status(403).json({ success: false, error: 'Only patients can check for active video calls' });
    }

    const activeCall = await VideoCallService.getActiveCallForPatient(userId);
    
    if (activeCall) {
      res.json({ 
        success: true, 
        data: activeCall,
        message: 'Active video call found' 
      });
    } else {
      res.json({ 
        success: true, 
        data: null,
        message: 'No active video calls' 
      });
    }
  } catch (error) {
    console.error('Error checking for active video calls:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to check for active video calls' });
  }
});

// End/clear active video call - for doctors
router.post('/end-active', [authenticate], async (req: Request, res: Response) => {
  try {
    const userId = req.user!._id.toString();
    const userRole = req.user!.role;

    // Only doctors can end active calls
    if (userRole !== 'doctor') {
      return res.status(403).json({ success: false, error: 'Only doctors can end active video calls' });
    }

    // Find active video call appointments for this doctor
    const { Appointment } = await import('../models/Appointment');
    const activeCall = await Appointment.findOne({
      doctor: userId,
      status: 'confirmed',
      consultationType: 'video',
      videoCallId: { $exists: true }
    });

    if (!activeCall) {
      return res.json({ 
        success: true, 
        data: null,
        message: 'No active video calls to end' 
      });
    }

    // End the video call by clearing the video call fields
    await Appointment.findByIdAndUpdate(
      activeCall._id,
      {
        $unset: {
          videoCallId: "",
          videoCallUrl: ""
        },
        status: 'completed',
        updatedAt: new Date()
      }
    );

    // Dismiss the patient's "incoming call" banner immediately (poll clears it otherwise, up to 15s later)
    const { SocketService } = await import('../services/SocketService');
    SocketService.emitToUser(activeCall.patient.toString(), 'call:ended', {
      appointmentId: activeCall._id.toString(),
    });

    res.json({
      success: true,
      data: { appointmentId: activeCall._id },
      message: 'Active video call ended successfully'
    });
  } catch (error) {
    console.error('Error ending active video call:', error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Failed to end active video call' });
  }
});

export default router; 