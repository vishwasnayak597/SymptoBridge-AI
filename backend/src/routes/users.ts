// @ts-nocheck
import express, { Request, Response } from 'express';
import User from '../models/User';
import { authenticate } from '../middleware/auth';

const router = express.Router();

type DoctorFilter = Record<string, unknown>;

/**
 * Load active verified doctors, sorted by distance when the caller shares coordinates.
 * The geospatial path uses a 2dsphere $geoNear; if the index isn't available yet it falls
 * back to a plain listing so the core feature never breaks on a sort concern.
 */
async function loadDoctors(
  filter: DoctorFilter,
  near: { lat: number; lng: number; maxKm: number } | null
): Promise<any[]> {
  if (!near) {
    return User.find(filter).lean();
  }

  try {
    const withGeo = await User.aggregate([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [near.lng, near.lat] },
          distanceField: 'distanceMeters',
          maxDistance: near.maxKm * 1000,
          query: filter,
          spherical: true,
          key: 'location.geo',
        },
      },
    ]);
    // $geoNear only returns docs that have coordinates; append the rest with unknown distance.
    const seen = new Set(withGeo.map((d) => d._id.toString()));
    const withoutGeo = await User.find({ ...filter, 'location.geo.coordinates': { $exists: false } }).lean();
    return [...withGeo, ...withoutGeo.filter((d) => !seen.has(d._id.toString()))];
  } catch (err) {
    // e.g. index still building right after a deploy — degrade to a plain listing.
    return User.find(filter).lean();
  }
}

/**
 * @route GET /api/users/doctors
 * @desc Get verified doctors, nearest-first when lat/lng are provided
 * @access Public (for patients to find doctors)
 */
router.get('/doctors', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const maxKm = parseFloat(req.query.maxKm as string) || 5000; // default: effectively unbounded
    const baseFilter = { role: 'doctor', isEmailVerified: true, isActive: true };

    const hasLocation = !Number.isNaN(lat) && !Number.isNaN(lng);
    let doctors = await loadDoctors(baseFilter, hasLocation ? { lat, lng, maxKm } : null);

    // Transform data to match frontend expectations
    const transformedDoctors = doctors.map(doctor => ({
      distanceKm: typeof doctor.distanceMeters === 'number'
        ? Math.round((doctor.distanceMeters / 1000) * 10) / 10
        : null,
      _id: doctor._id,
      firstName: doctor.firstName,
      lastName: doctor.lastName,
      email: doctor.email,
      phone: doctor.phone,
      specialization: doctor.specialization,
      experience: doctor.experience,
      consultationFee: doctor.consultationFee,
      rating: doctor.rating,
      reviewCount: doctor.reviewCount || 0,
      qualifications: doctor.qualifications,
      licenseNumber: doctor.licenseNumber,
      availability: doctor.availability,
      bio: doctor.bio,
      location: doctor.location,
      // Also check for profile.address structure if location is not available
      address: doctor.location || doctor.profile?.address,
      isOnline: doctor.isOnline || false
    }));

    res.json({
      success: true,
      message: 'Doctors retrieved successfully',
      data: transformedDoctors
    });
  } catch (error) {
    console.error('Error fetching doctors:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch doctors'
    });
  }
});

/**
 * @route GET /api/users/profile
 * @desc Get current user profile
 * @access Private
 */
router.get('/profile', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await User.findById(req.user!._id).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile retrieved successfully',
      data: user
    });
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch profile'
    });
  }
});

/**
 * @route PUT /api/users/profile
 * @desc Update current user profile
 * @access Private
 */
router.put('/profile', authenticate, async (req: Request, res: Response) => {
  try {
    const userId = req.user!._id;
    const { role } = req.user!;
    
    // Extract allowed fields based on role
    const allowedFields = ['firstName', 'lastName', 'phone', 'bio'];
    
    if (role === 'doctor') {
      allowedFields.push(
        'specialization', 
        'consultationFee', 
        'experience', 
        'qualifications',
        'licenseNumber',
        'availability',
        'location'
      );
    } else if (role === 'patient') {
      allowedFields.push(
        'dateOfBirth',
        'gender', 
        'bloodGroup',
        'emergencyContact',
        'medicalHistory',
        'allergies'
      );
    }

    // Filter request body to only include allowed fields
    const updateData: any = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    // Validate consultation fee for doctors
    if (role === 'doctor' && updateData.consultationFee !== undefined) {
      const fee = parseFloat(updateData.consultationFee);
      if (isNaN(fee) || fee < 0) {
        return res.status(400).json({
          success: false,
          error: 'Consultation fee must be a valid positive number'
        });
      }
      updateData.consultationFee = fee;
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: updatedUser
    });

  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update profile'
    });
  }
});

/**
 * @route GET /api/users/admin/all
 * @desc Get all users for admin dashboard
 * @access Admin only
 */
router.get('/admin/all', authenticate, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { page = 1, limit = 50, role, search, status } = req.query;
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Build query
    const query: any = {};
    
    if (role && role !== 'all') {
      query.role = role;
    }
    
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    if (status === 'active') {
      query.isActive = true;
    } else if (status === 'inactive') {
      query.isActive = false;
    }

    const users = await User.find(query)
      .select('firstName lastName email role isActive isEmailVerified createdAt lastLoginAt specialization experience consultationFee')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const totalUsers = await User.countDocuments(query);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(totalUsers / limitNum),
          totalUsers,
          hasNext: pageNum * limitNum < totalUsers,
          hasPrev: pageNum > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching users for admin:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

/**
 * @route GET /api/users/admin/stats
 * @desc Get platform statistics for admin
 * @access Admin only
 */
router.get('/admin/stats', authenticate, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const [
      totalUsers,
      totalDoctors,
      totalPatients,
      totalAdmins,
      activeUsers,
      totalAppointments,
      pendingDoctors
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'doctor' }),
      User.countDocuments({ role: 'patient' }),
      User.countDocuments({ role: 'admin' }),
      User.countDocuments({ isActive: true }),
      // You'll need to import Appointment model
      // Appointment.countDocuments(),
      0, // Placeholder for now
      User.countDocuments({ role: 'doctor', isEmailVerified: false })
    ]);

    // Get recent activity (last 24 hours)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentSignups = await User.countDocuments({ 
      createdAt: { $gte: yesterday } 
    });

    const stats = {
      totalUsers,
      totalDoctors,
      totalPatients,
      totalAdmins,
      activeUsers,
      totalAppointments,
      pendingVerifications: pendingDoctors,
      recentSignups,
      systemHealth: 'healthy', // Can be enhanced with actual system checks
      totalRevenue: 0 // Placeholder - implement with Payment model
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
});

/**
 * @route PUT /api/users/admin/:userId/status
 * @desc Update user status (activate/deactivate)
 * @access Admin only
 */
router.put('/admin/:userId/status', authenticate, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { userId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isActive must be a boolean' });
    }

    // Prevent admin from deactivating themselves
    if (userId === req.user!._id.toString()) {
      return res.status(400).json({ success: false, error: 'Cannot change your own status' });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      { isActive },
      { new: true, runValidators: true }
    ).select('firstName lastName email role isActive');

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({
      success: true,
      data: user,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ success: false, error: 'Failed to update user status' });
  }
});

/**
 * @route PUT /api/users/admin/:userId/verify
 * @desc Verify a doctor's account
 * @access Admin only
 */
router.put('/admin/:userId/verify', authenticate, async (req: Request, res: Response) => {
  try {
    if (req.user!.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Admin access required' });
    }

    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (user.role !== 'doctor') {
      return res.status(400).json({ success: false, error: 'Only doctors can be verified' });
    }

    user.isEmailVerified = true;
    user.isActive = true;
    await user.save();

    res.json({
      success: true,
      data: user,
      message: 'Doctor verified successfully'
    });
  } catch (error) {
    console.error('Error verifying doctor:', error);
    res.status(500).json({ success: false, error: 'Failed to verify doctor' });
  }
});

export default router; 