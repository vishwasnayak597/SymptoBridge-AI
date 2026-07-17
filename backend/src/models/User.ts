import mongoose, { Schema, Document } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User as IUser, Patient, Doctor, Admin } from '../../../shared/types';

const SALT_ROUNDS = 12;
const MAX_LOGIN_ATTEMPTS = 50;
const LOCK_TIME = 1 * 60 * 60 * 1000;

export interface IUserDocument extends Document {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  fullName?: string; // virtual
  phone?: string;
  avatar?: string;
  role: 'patient' | 'doctor' | 'admin';
  isActive: boolean;
  isEmailVerified: boolean;
  emailVerificationToken?: string;
  passwordResetToken?: string;
  passwordResetExpires?: Date;
  loginAttempts?: number;
  lockUntil?: Date;
  lastLogin?: Date;
  refreshTokens: string[];
  createdAt: Date;
  updatedAt: Date;
  
  dateOfBirth?: Date;
  gender?: 'male' | 'female' | 'other';
  bloodGroup?: string;
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  medicalHistory?: string[];
  allergies?: string[];
  
  specialization?: string;
  licenseNumber?: string;
  experience?: number;
  qualifications?: string[];
  consultationFee?: number;
  isVerified?: boolean;
  rating?: number;
  reviewCount?: number;
  bio?: string;
  availability?: Array<{
    dayOfWeek: number;
    startTime: string;
    endTime: string;
    isAvailable: boolean;
  }>;
  location?: {
    address: string;
    city: string;
    state: string;
    zipCode: string;
    coordinates?: {
      latitude: number;
      longitude: number;
    };
  };
  
  permissions?: string[];
  
  comparePassword(candidatePassword: string): Promise<boolean>;
  isLocked(): boolean;
  incLoginAttempts(): Promise<void>;
  resetLoginAttempts(): Promise<void>;
  addRefreshToken(token: string): Promise<void>;
  removeRefreshToken(token: string): Promise<void>;
  toUserObject(): IUser;
}

const UserSchema = new Schema<IUserDocument>({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 7
  },
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  phone: {
    type: String,
    trim: true,
    match: /^[\+]?[1-9][\d]{0,15}$/
  },
  avatar: {
    type: String,
    default: null
  },
  role: {
    type: String,
    enum: ['patient', 'doctor', 'admin'],
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isEmailVerified: {
    type: Boolean,
    default: true
  },
  emailVerificationToken: String,
  passwordResetToken: String,
  passwordResetExpires: Date,
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: Date,
  lastLogin: Date,
  refreshTokens: [{
    type: String
  }],
  
  dateOfBirth: Date,
  gender: {
    type: String,
    enum: ['male', 'female', 'other']
  },
  bloodGroup: String,
  emergencyContact: {
    name: String,
    phone: String,
    relationship: String
  },
  medicalHistory: [String],
  allergies: [String],
  
  specialization: String,
  licenseNumber: String,
  experience: Number,
  qualifications: [String],
  consultationFee: Number,
  isVerified: {
    type: Boolean,
    default: false
  },
  rating: Number,
  reviewCount: Number,
  bio: String,
  availability: [{
    dayOfWeek: {
      type: Number,
      min: 0,
      max: 6
    },
    startTime: String,
    endTime: String,
    isAvailable: Boolean
  }],
  location: {
    address: String,
    city: String,
    state: String,
    zipCode: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    },
    // GeoJSON Point [lng, lat] — the shape the 2dsphere index actually requires
    // (the legacy {latitude, longitude} object above cannot be geo-queried).
    geo: {
      type: {
        type: String,
        enum: ['Point']
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: undefined
      }
    }
  },

  permissions: [String]
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.refreshTokens;
      delete ret.emailVerificationToken;
      delete ret.passwordResetToken;
      delete ret.loginAttempts;
      delete ret.lockUntil;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// Convenience virtual used across notifications ("Dr. {fullName}", "received from {fullName}").
UserSchema.virtual('fullName').get(function (this: IUserDocument) {
  return `${this.firstName || ''} ${this.lastName || ''}`.trim();
});

/**
 * Hash password before saving
 */
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    this.password = await bcrypt.hash(this.password, SALT_ROUNDS);
    next();
  } catch (error) {
    next(error);
  }
});

/**
 * Compare provided password with stored hash
 */
UserSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * Check if account is locked
 */
UserSchema.methods.isLocked = function(): boolean {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

/**
 * Increment login attempts and lock account if needed
 */
UserSchema.methods.incLoginAttempts = async function(): Promise<void> {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: {
        loginAttempts: 1,
        lockUntil: 1
      }
    });
  }
  
  const updates: any = { $inc: { loginAttempts: 1 } };
  
  if (this.loginAttempts + 1 >= MAX_LOGIN_ATTEMPTS && !this.isLocked()) {
    updates.$set = {
      lockUntil: Date.now() + LOCK_TIME
    };
  }
  
  return this.updateOne(updates);
};

/**
 * Reset login attempts
 */
UserSchema.methods.resetLoginAttempts = async function(): Promise<void> {
  return this.updateOne({
    $unset: {
      loginAttempts: 1,
      lockUntil: 1
    },
    $set: {
      lastLogin: new Date()
    }
  });
};

/**
 * Add refresh token
 */
UserSchema.methods.addRefreshToken = async function(token: string): Promise<void> {
  this.refreshTokens.push(token);
  await this.save();
};

/**
 * Remove refresh token
 */
UserSchema.methods.removeRefreshToken = async function(token: string): Promise<void> {
  this.refreshTokens = this.refreshTokens.filter(t => t !== token);
  await this.save();
};

/**
 * Convert to typed user object
 */
UserSchema.methods.toUserObject = function(): IUser {
  const userObj = this.toObject();
  delete userObj.password;
  delete userObj.refreshTokens;
  delete userObj.emailVerificationToken;
  delete userObj.passwordResetToken;
  delete userObj.loginAttempts;
  delete userObj.lockUntil;
  
  return userObj as IUser;
};

// email already has a unique index from `unique: true` on the field.
UserSchema.index({ role: 1 });
UserSchema.index({ 'location.geo': '2dsphere' }, { sparse: true });

export default mongoose.model<IUserDocument>('User', UserSchema); 