import express from 'express';
import { auth } from '../middleware/auth';
import { Prescription } from '../models/Prescription';
import { Appointment } from '../models/Appointment';

const router = express.Router();

// @desc    Create a prescription
// @route   POST /api/prescriptions
// @access  Private (Doctor only)
router.post('/', auth, async (req, res) => {
  try {
    const { role } = req.user!;
    
    if (role !== 'doctor') {
      return res.status(403).json({ message: 'Only doctors can create prescriptions' });
    }

    const {
      patient,
      appointment,
      medications,
      generalInstructions,
      validTill
    } = req.body;

    const prescription = new Prescription({
      patient,
      doctor: req.user!._id,
      appointment,
      medications,
      generalInstructions,
      validTill
    });

    
    await prescription.save();

    const { publishEvent } = await import('../services/EventBus');
    publishEvent({
      type: 'prescription.issued',
      actorId: req.user!._id.toString(),
      entityType: 'prescription',
      entityId: prescription._id.toString(),
      payload: { patient: String(patient), medicationCount: medications?.length || 0 }
    });

    await prescription.populate([
      { path: 'patient', select: 'firstName lastName email' },
      { path: 'doctor', select: 'firstName lastName specialization' }
    ]);

    res.status(201).json({
      success: true,
      data: prescription
    });
  } catch (error) {
    console.error('Error creating prescription:', error);
    
    // More detailed error logging
    if (error.name === 'ValidationError') {
      console.error('Validation errors:', error.errors);
      return res.status(400).json({ 
        message: 'Validation error',
        errors: Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message
        }))
      });
    }
    
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Get prescriptions for a patient (doctor view)
// @route   GET /api/prescriptions/patient/:patientId
// @access  Private (Doctor only)
router.get('/patient/:patientId', auth, async (req, res) => {
  try {
    const { role } = req.user!;
    const { patientId } = req.params;
    
    if (role !== 'doctor') {
      return res.status(403).json({ message: 'Only doctors can view patient prescriptions' });
    }

    // Check if doctor has appointments with this patient
    const hasAppointment = await Appointment.findOne({
      doctor: req.user!._id,
      patient: patientId
    });

    if (!hasAppointment) {
      return res.status(403).json({ message: 'You can only view prescriptions for your patients' });
    }

    const prescriptions = await Prescription.find({ patient: patientId })
      .populate([
        { path: 'patient', select: 'firstName lastName email' },
        { path: 'doctor', select: 'firstName lastName specialization' },
        { path: 'appointment', select: 'appointmentDate consultationType' }
      ])
      .sort({ date: -1 });

    res.json({
      success: true,
      data: prescriptions
    });
  } catch (error) {
    console.error('Error fetching prescriptions:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Get prescriptions for current patient
// @route   GET /api/prescriptions/my-prescriptions
// @access  Private (Patient only)
router.get('/my-prescriptions', auth, async (req, res) => {
  try {
    const { role } = req.user!;
    
    if (role !== 'patient') {
      return res.status(403).json({ message: 'Only patients can view their own prescriptions' });
    }

    const prescriptions = await Prescription.find({ patient: req.user!._id })
      .populate([
        { path: 'doctor', select: 'firstName lastName specialization' },
        { path: 'appointment', select: 'appointmentDate consultationType' }
      ])
      .sort({ date: -1 });

    res.json({
      success: true,
      data: prescriptions
    });
  } catch (error) {
    console.error('Error fetching prescriptions:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Get active prescriptions for current patient
// @route   GET /api/prescriptions/my-active-prescriptions
// @access  Private (Patient only)
router.get('/my-active-prescriptions', auth, async (req, res) => {
  try {
    const { role } = req.user!;
    
    if (role !== 'patient') {
      return res.status(403).json({ message: 'Only patients can view their own prescriptions' });
    }

    const prescriptions = await Prescription.find({ 
      patient: req.user!._id,
      status: 'active',
      $or: [
        { validTill: { $gte: new Date() } },
        { validTill: { $exists: false } }
      ]
    })
      .populate([
        { path: 'doctor', select: 'firstName lastName specialization' },
        { path: 'appointment', select: 'appointmentDate consultationType' }
      ])
      .sort({ date: -1 });

    res.json({
      success: true,
      data: prescriptions
    });
  } catch (error) {
    console.error('Error fetching active prescriptions:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Update prescription status
// @route   PUT /api/prescriptions/:id/status
// @access  Private (Doctor or Patient)
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const { role } = req.user!;

    if (!['active', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const prescription = await Prescription.findById(req.params.id);
    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    // Check permissions
    if (role === 'doctor' && prescription.doctor.toString() !== req.user!._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    
    if (role === 'patient' && prescription.patient.toString() !== req.user!._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    prescription.status = status;
    await prescription.save();

    await prescription.populate([
      { path: 'patient', select: 'firstName lastName email' },
      { path: 'doctor', select: 'firstName lastName specialization' }
    ]);

    res.json({
      success: true,
      data: prescription
    });
  } catch (error) {
    console.error('Error updating prescription status:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @desc    Get prescription by ID
// @route   GET /api/prescriptions/:id
// @access  Private (Doctor or Patient)
router.get('/:id', auth, async (req, res) => {
  try {
    const prescription = await Prescription.findById(req.params.id)
      .populate([
        { path: 'patient', select: 'firstName lastName email dateOfBirth' },
        { path: 'doctor', select: 'firstName lastName specialization licenseNumber' },
        { path: 'appointment', select: 'appointmentDate consultationType' }
      ]);

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    const { role } = req.user!;
    
    // Check permissions
    if (role === 'doctor' && prescription.doctor._id.toString() !== req.user!._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    
    if (role === 'patient' && prescription.patient._id.toString() !== req.user!._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json({
      success: true,
      data: prescription
    });
  } catch (error) {
    console.error('Error fetching prescription:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router; 