const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const OTP = require('../models/OTP');
const { sendOTPEmail, sendWelcomeEmail } = require('../utils/email');
const { authenticateToken } = require('../middleware/auth');
const { validateUserSignup, validateUserLogin, validateOTP } = require('../middleware/validation');

const router = express.Router();

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d'
  });
};

// Send OTP for signup
router.post('/send-otp', validateUserSignup, async (req, res) => {
  try {
    const { email, fullName, phone, role, gender, dateOfBirth, vehicleType, vehicleNumber, licenseNumber, subDrivers, referralCode } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        status: 'error',
        message: 'User already exists with this email'
      });
    }

    // Check if phone already exists
    const existingPhone = await User.findOne({ phone });
    if (existingPhone) {
      return res.status(400).json({
        status: 'error',
        message: 'User already exists with this phone number'
      });
    }

    // Check referral code if provided
    let referredBy = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) {
        referredBy = referrer._id;
      }
    }

    // Generate OTP
    const otpCode = OTP.generateOTP();

    // Save OTP
    await OTP.create({
      email,
      phone,
      otp: otpCode,
      type: 'signup'
    });

    // Send OTP email
    const emailResult = await sendOTPEmail(email, otpCode, 'signup');
    if (!emailResult.success) {
      console.error('Failed to send OTP email:', emailResult.error);
    }

    // Store user data temporarily (you might want to use Redis for this)
    // For now, we'll store it in the request session or use a different approach
    req.tempUserData = {
      fullName,
      email,
      phone,
      role,
      gender,
      dateOfBirth,
      vehicleType,
      vehicleNumber,
      licenseNumber,
      subDrivers,
      referredBy
    };

    res.status(200).json({
      status: 'success',
      message: 'OTP sent successfully to your email'
    });

  } catch (error) {
    console.error('Send OTP error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to send OTP'
    });
  }
});

// Verify OTP and create user
router.post('/verify-otp', validateOTP, async (req, res) => {
  try {
    const { email, otp, referralCode } = req.body;

    // Find and verify OTP
    const otpRecord = await OTP.findOne({ 
      email, 
      type: 'signup',
      isUsed: false 
    });

    if (!otpRecord) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired OTP'
      });
    }

    const verification = otpRecord.verifyOTP(otp);
    if (!verification.success) {
      await otpRecord.save(); // Save attempt count
      return res.status(400).json({
        status: 'error',
        message: verification.message
      });
    }

    await otpRecord.save();

    // Get user data from request (in production, use Redis or session)
    const userData = req.tempUserData;
    if (!userData) {
      return res.status(400).json({
        status: 'error',
        message: 'User data not found. Please try signing up again.'
      });
    }

    // Create user
    const user = new User({
      fullName: userData.fullName,
      email: userData.email,
      phone: userData.phone,
      role: userData.role,
      gender: userData.gender,
      dateOfBirth: userData.dateOfBirth,
      isVerified: true,
      referredBy: userData.referredBy
    });

    // Add driver info if role is Driver
    if (userData.role === 'Driver') {
      user.driverInfo = {
        vehicleType: userData.vehicleType,
        vehicleNumber: userData.vehicleNumber,
        licenseNumber: userData.licenseNumber
      };

      // Add sub-drivers if any
      if (userData.subDrivers && userData.subDrivers.length > 0) {
        user.subDrivers = userData.subDrivers;
      }
    }

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    // Send welcome email
    await sendWelcomeEmail(user.email, user.fullName);

    // Update referrer's earnings if applicable
    if (userData.referredBy) {
      await User.findByIdAndUpdate(userData.referredBy, {
        $inc: { 'referralEarnings': 50 } // ₹50 referral bonus
      });
    }

    res.status(201).json({
      status: 'success',
      message: 'Account created successfully',
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        referralCode: user.referralCode
      }
    });

  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to verify OTP'
    });
  }
});

// Send login OTP
router.post('/login-otp', validateUserLogin, async (req, res) => {
  try {
    const { email } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        status: 'error',
        message: 'Account is deactivated'
      });
    }

    // Generate OTP
    const otpCode = OTP.generateOTP();

    // Save OTP
    await OTP.create({
      email,
      otp: otpCode,
      type: 'login'
    });

    // Send OTP email
    const emailResult = await sendOTPEmail(email, otpCode, 'login');
    if (!emailResult.success) {
      console.error('Failed to send OTP email:', emailResult.error);
    }

    res.status(200).json({
      status: 'success',
      message: 'OTP sent successfully to your email'
    });

  } catch (error) {
    console.error('Login OTP error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to send login OTP'
    });
  }
});

// Verify login OTP
router.post('/verify-login-otp', validateOTP, async (req, res) => {
  try {
    const { email, otp } = req.body;

    // Find and verify OTP
    const otpRecord = await OTP.findOne({ 
      email, 
      type: 'login',
      isUsed: false 
    });

    if (!otpRecord) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid or expired OTP'
      });
    }

    const verification = otpRecord.verifyOTP(otp);
    if (!verification.success) {
      await otpRecord.save();
      return res.status(400).json({
        status: 'error',
        message: verification.message
      });
    }

    await otpRecord.save();

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Update last seen
    user.lastSeen = new Date();
    user.isOnline = true;
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.status(200).json({
      status: 'success',
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isVerified: user.isVerified,
        referralCode: user.referralCode,
        profileImage: user.profileImage
      }
    });

  } catch (error) {
    console.error('Verify login OTP error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to verify login OTP'
    });
  }
});

// Logout
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    // Update user status
    await User.findByIdAndUpdate(req.user._id, {
      isOnline: false,
      lastSeen: new Date()
    });

    res.status(200).json({
      status: 'success',
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to logout'
    });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    res.status(200).json({
      status: 'success',
      user: req.user
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get user data'
    });
  }
});

// Refresh token
router.post('/refresh-token', authenticateToken, async (req, res) => {
  try {
    const token = generateToken(req.user._id);
    
    res.status(200).json({
      status: 'success',
      token
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to refresh token'
    });
  }
});

module.exports = router;
