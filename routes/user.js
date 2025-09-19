const express = require('express');
const User = require('../models/User');
const Ride = require('../models/Ride');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const { authenticateToken, requireVerification } = require('../middleware/auth');
const { validatePagination } = require('../middleware/validation');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

const router = express.Router();

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Get user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-wallet.transactions');
    
    res.status(200).json({
      status: 'success',
      data: user
    });

  } catch (error) {
    console.error('Get user profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get user profile'
    });
  }
});

// Update user profile
router.patch('/profile', authenticateToken, async (req, res) => {
  try {
    const {
      fullName,
      phone,
      gender,
      dateOfBirth,
      emergencyContacts,
      preferences
    } = req.body;

    const updateData = {};
    
    if (fullName) updateData.fullName = fullName;
    if (phone) updateData.phone = phone;
    if (gender) updateData.gender = gender;
    if (dateOfBirth) updateData.dateOfBirth = new Date(dateOfBirth);
    if (emergencyContacts) updateData.emergencyContacts = emergencyContacts;
    if (preferences) updateData.preferences = { ...req.user.preferences, ...preferences };

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true }
    ).select('-wallet.transactions');

    res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully',
      data: user
    });

  } catch (error) {
    console.error('Update user profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update profile'
    });
  }
});

// Upload profile image
router.post('/profile-image', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        status: 'error',
        message: 'No image file provided'
      });
    }

    // Upload to Cloudinary
    const result = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          resource_type: 'image',
          folder: 'idhar-udhar/profiles',
          public_id: `user_${req.user._id}_${Date.now()}`,
          transformation: [
            { width: 400, height: 400, crop: 'fill', gravity: 'face' }
          ]
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }
      ).end(req.file.buffer);
    });

    // Update user profile image
    await User.findByIdAndUpdate(req.user._id, {
      profileImage: result.secure_url
    });

    res.status(200).json({
      status: 'success',
      message: 'Profile image uploaded successfully',
      data: {
        profileImage: result.secure_url
      }
    });

  } catch (error) {
    console.error('Upload profile image error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to upload profile image'
    });
  }
});

// Get user statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user._id;

    // Get total rides
    const totalRides = await Ride.countDocuments({
      user: userId,
      status: 'completed'
    });

    // Get total spent
    const totalSpent = await Ride.aggregate([
      {
        $match: {
          user: userId,
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$pricing.finalAmount' }
        }
      }
    ]);

    // Get favorite vehicle type
    const favoriteVehicle = await Ride.aggregate([
      {
        $match: {
          user: userId,
          status: 'completed'
        }
      },
      {
        $group: {
          _id: '$rideType',
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 1
      }
    ]);

    // Get monthly stats
    const currentMonth = new Date();
    currentMonth.setDate(1);
    currentMonth.setHours(0, 0, 0, 0);

    const monthlyRides = await Ride.countDocuments({
      user: userId,
      status: 'completed',
      createdAt: { $gte: currentMonth }
    });

    const monthlySpent = await Ride.aggregate([
      {
        $match: {
          user: userId,
          status: 'completed',
          createdAt: { $gte: currentMonth }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$pricing.finalAmount' }
        }
      }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        totalRides,
        totalSpent: totalSpent[0]?.total || 0,
        favoriteVehicle: favoriteVehicle[0]?._id || 'N/A',
        monthlyRides,
        monthlySpent: monthlySpent[0]?.total || 0,
        walletBalance: req.user.wallet.balance
      }
    });

  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get user statistics'
    });
  }
});

// Get user's ride history
router.get('/rides', authenticateToken, validatePagination, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    const filter = { user: req.user._id };
    if (status) {
      filter.status = status;
    }

    const rides = await Ride.find(filter)
      .populate('driver', 'fullName phone driverInfo.vehicleType driverInfo.rating')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Ride.countDocuments(filter);

    res.status(200).json({
      status: 'success',
      data: {
        rides,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    console.error('Get user rides error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get ride history'
    });
  }
});

// Get wallet balance and transactions
router.get('/wallet', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const user = await User.findById(req.user._id)
      .select('wallet.balance wallet.transactions')
      .populate('wallet.transactions.rideId', 'pickup destination status');

    const transactions = user.wallet.transactions
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(skip, skip + parseInt(limit));

    const total = user.wallet.transactions.length;

    res.status(200).json({
      status: 'success',
      data: {
        balance: user.wallet.balance,
        transactions,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    console.error('Get wallet error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get wallet information'
    });
  }
});

// Add money to wallet
router.post('/wallet/topup', authenticateToken, async (req, res) => {
  try {
    const { amount, paymentMethod = 'razorpay' } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid amount'
      });
    }

    // Create payment order for wallet top-up
    const { createOrder } = require('../utils/razorpay');
    
    const orderResult = await createOrder(
      amount,
      'INR',
      `wallet_topup_${req.user._id}_${Date.now()}`,
      {
        userId: req.user._id.toString(),
        type: 'wallet_topup'
      }
    );

    if (!orderResult.success) {
      return res.status(400).json({
        status: 'error',
        message: 'Failed to create payment order',
        error: orderResult.error
      });
    }

    // Create payment record
    const payment = new Payment({
      user: req.user._id,
      type: 'wallet_topup',
      amount: amount,
      method: paymentMethod,
      status: 'pending',
      razorpay: {
        orderId: orderResult.order.id,
        receipt: orderResult.order.receipt,
        notes: orderResult.order.notes
      }
    });

    await payment.save();

    res.status(200).json({
      status: 'success',
      message: 'Payment order created for wallet top-up',
      data: {
        order: {
          id: orderResult.order.id,
          amount: orderResult.order.amount,
          currency: orderResult.order.currency
        },
        paymentId: payment._id
      }
    });

  } catch (error) {
    console.error('Wallet top-up error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to process wallet top-up'
    });
  }
});

// Get notifications
router.get('/notifications', authenticateToken, validatePagination, async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    const skip = (page - 1) * limit;

    const filter = { user: req.user._id };
    if (unreadOnly === 'true') {
      filter.isRead = false;
    }

    const notifications = await Notification.find(filter)
      .populate('data.rideId', 'pickup destination status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      isRead: false
    });

    res.status(200).json({
      status: 'success',
      data: {
        notifications,
        unreadCount,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get notifications'
    });
  }
});

// Mark notification as read
router.patch('/notifications/:notificationId/read', authenticateToken, async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.notificationId);

    if (!notification) {
      return res.status(404).json({
        status: 'error',
        message: 'Notification not found'
      });
    }

    if (notification.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized access to notification'
      });
    }

    await notification.markAsRead();

    res.status(200).json({
      status: 'success',
      message: 'Notification marked as read'
    });

  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to mark notification as read'
    });
  }
});

// Mark all notifications as read
router.patch('/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    await Notification.markAllAsRead(req.user._id);

    res.status(200).json({
      status: 'success',
      message: 'All notifications marked as read'
    });

  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to mark all notifications as read'
    });
  }
});

// Get referral information
router.get('/referral', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('referralCode referralEarnings')
      .populate('referredBy', 'fullName email');

    // Get referral statistics
    const referralStats = await User.aggregate([
      {
        $match: { referredBy: req.user._id }
      },
      {
        $group: {
          _id: null,
          totalReferrals: { $sum: 1 },
          totalEarnings: { $sum: '$referralEarnings' }
        }
      }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        referralCode: user.referralCode,
        referralEarnings: user.referralEarnings,
        referredBy: user.referredBy,
        stats: referralStats[0] || { totalReferrals: 0, totalEarnings: 0 }
      }
    });

  } catch (error) {
    console.error('Get referral info error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get referral information'
    });
  }
});

// Update notification preferences
router.patch('/preferences/notifications', authenticateToken, async (req, res) => {
  try {
    const { email, sms, push } = req.body;

    const updateData = {};
    if (email !== undefined) updateData['preferences.notifications.email'] = email;
    if (sms !== undefined) updateData['preferences.notifications.sms'] = sms;
    if (push !== undefined) updateData['preferences.notifications.push'] = push;

    await User.findByIdAndUpdate(req.user._id, updateData);

    res.status(200).json({
      status: 'success',
      message: 'Notification preferences updated successfully'
    });

  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update notification preferences'
    });
  }
});

// Delete account
router.delete('/account', authenticateToken, async (req, res) => {
  try {
    const { password, reason } = req.body;

    // Check if user has any active rides
    const activeRides = await Ride.countDocuments({
      user: req.user._id,
      status: { $in: ['pending', 'searching', 'accepted', 'arrived', 'started'] }
    });

    if (activeRides > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot delete account with active rides'
      });
    }

    // Soft delete - mark as inactive
    await User.findByIdAndUpdate(req.user._id, {
      isActive: false,
      email: `deleted_${Date.now()}_${req.user.email}`,
      phone: `deleted_${Date.now()}_${req.user.phone}`
    });

    res.status(200).json({
      status: 'success',
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to delete account'
    });
  }
});

module.exports = router;
