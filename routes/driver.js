const express = require('express');
const Ride = require('../models/Ride');
const User = require('../models/User');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const { authenticateToken, requireDriver } = require('../middleware/auth');
const { validateLocation, validateObjectId, validatePagination } = require('../middleware/validation');

const router = express.Router();

// Get driver dashboard data
router.get('/dashboard', authenticateToken, requireDriver, async (req, res) => {
  try {
    const driverId = req.user._id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Get today's rides
    const todayRides = await Ride.find({
      driver: driverId,
      createdAt: { $gte: today, $lt: tomorrow },
      status: 'completed'
    });

    // Get total earnings
    const totalEarnings = await Ride.aggregate([
      {
        $match: {
          driver: driverId,
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

    // Get today's earnings
    const todayEarnings = todayRides.reduce((sum, ride) => sum + ride.pricing.finalAmount, 0);

    // Get total rides
    const totalRides = await Ride.countDocuments({
      driver: driverId,
      status: 'completed'
    });

    // Get current rating
    const ratingResult = await Ride.aggregate([
      {
        $match: {
          driver: driverId,
          status: 'completed',
          'rating.userRating.rating': { $exists: true }
        }
      },
      {
        $group: {
          _id: null,
          averageRating: { $avg: '$rating.userRating.rating' },
          totalRatings: { $sum: 1 }
        }
      }
    ]);

    // Get recent rides
    const recentRides = await Ride.find({
      driver: driverId
    })
    .populate('user', 'fullName phone')
    .sort({ createdAt: -1 })
    .limit(5);

    // Get weekly earnings
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weeklyEarnings = await Ride.aggregate([
      {
        $match: {
          driver: driverId,
          createdAt: { $gte: weekStart },
          status: 'completed'
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          earnings: { $sum: '$pricing.finalAmount' },
          rides: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        stats: {
          todayEarnings,
          totalEarnings: totalEarnings[0]?.total || 0,
          todayRides: todayRides.length,
          totalRides,
          rating: ratingResult[0]?.averageRating || 0,
          totalRatings: ratingResult[0]?.totalRatings || 0
        },
        recentRides,
        weeklyEarnings
      }
    });

  } catch (error) {
    console.error('Get driver dashboard error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get dashboard data'
    });
  }
});

// Update driver availability
router.patch('/availability', authenticateToken, requireDriver, async (req, res) => {
  try {
    const { isAvailable } = req.body;

    await User.findByIdAndUpdate(req.user._id, {
      'driverInfo.isAvailable': isAvailable
    });

    res.status(200).json({
      status: 'success',
      message: `Driver ${isAvailable ? 'available' : 'unavailable'} successfully`
    });

  } catch (error) {
    console.error('Update driver availability error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update availability'
    });
  }
});

// Get available ride requests
router.get('/ride-requests', authenticateToken, requireDriver, async (req, res) => {
  try {
    const { lat, lng, radius = 10000 } = req.query; // 10km default radius

    if (!lat || !lng) {
      return res.status(400).json({
        status: 'error',
        message: 'Current location is required'
      });
    }

    // Find nearby ride requests
    const rideRequests = await Ride.find({
      status: 'pending',
      rideType: req.user.driverInfo.vehicleType,
      pickup: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [parseFloat(lng), parseFloat(lat)]
          },
          $maxDistance: radius
        }
      }
    })
    .populate('user', 'fullName phone')
    .sort({ createdAt: -1 })
    .limit(20);

    res.status(200).json({
      status: 'success',
      data: {
        rideRequests,
        count: rideRequests.length
      }
    });

  } catch (error) {
    console.error('Get ride requests error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get ride requests'
    });
  }
});

// Accept ride request
router.post('/accept-ride/:rideId', authenticateToken, requireDriver, validateObjectId('rideId'), async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.rideId);

    if (!ride) {
      return res.status(404).json({
        status: 'error',
        message: 'Ride not found'
      });
    }

    if (ride.status !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: 'Ride is no longer available'
      });
    }

    if (ride.rideType !== req.user.driverInfo.vehicleType) {
      return res.status(400).json({
        status: 'error',
        message: 'Vehicle type mismatch'
      });
    }

    // Check if driver is available
    if (!req.user.driverInfo.isAvailable) {
      return res.status(400).json({
        status: 'error',
        message: 'Driver is not available'
      });
    }

    // Update ride
    ride.driver = req.user._id;
    ride.status = 'accepted';
    ride.actualPickupTime = new Date();
    await ride.save();

    // Update driver availability
    await User.findByIdAndUpdate(req.user._id, {
      'driverInfo.isAvailable': false
    });

    // Send notification to user
    const notification = new Notification({
      user: ride.user,
      title: 'Ride Accepted',
      message: `Your ride has been accepted by ${req.user.fullName}`,
      type: 'ride_update',
      data: { rideId: ride._id }
    });
    await notification.save();

    // Emit to user via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${ride.user}`).emit('ride-accepted', {
        rideId: ride._id,
        driver: {
          name: req.user.fullName,
          phone: req.user.phone,
          vehicleType: req.user.driverInfo.vehicleType,
          vehicleNumber: req.user.driverInfo.vehicleNumber,
          rating: req.user.driverInfo.rating
        }
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Ride accepted successfully',
      data: {
        rideId: ride._id,
        user: {
          name: ride.user.fullName,
          phone: ride.user.phone,
          pickup: ride.pickup,
          destination: ride.destination
        }
      }
    });

  } catch (error) {
    console.error('Accept ride error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to accept ride'
    });
  }
});

// Get driver's ride history
router.get('/rides', authenticateToken, requireDriver, validatePagination, async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    const filter = { driver: req.user._id };
    if (status) {
      filter.status = status;
    }

    const rides = await Ride.find(filter)
      .populate('user', 'fullName phone')
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
    console.error('Get driver rides error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get ride history'
    });
  }
});

// Get current ride
router.get('/current-ride', authenticateToken, requireDriver, async (req, res) => {
  try {
    const ride = await Ride.findOne({
      driver: req.user._id,
      status: { $in: ['accepted', 'arrived', 'started'] }
    })
    .populate('user', 'fullName phone');

    if (!ride) {
      return res.status(404).json({
        status: 'error',
        message: 'No current ride found'
      });
    }

    res.status(200).json({
      status: 'success',
      data: ride
    });

  } catch (error) {
    console.error('Get current ride error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get current ride'
    });
  }
});

// Update driver profile
router.patch('/profile', authenticateToken, requireDriver, async (req, res) => {
  try {
    const {
      vehicleType,
      vehicleNumber,
      vehicleModel,
      vehicleColor,
      licenseNumber,
      licenseExpiry
    } = req.body;

    const updateData = {};
    
    if (vehicleType) updateData['driverInfo.vehicleType'] = vehicleType;
    if (vehicleNumber) updateData['driverInfo.vehicleNumber'] = vehicleNumber;
    if (vehicleModel) updateData['driverInfo.vehicleModel'] = vehicleModel;
    if (vehicleColor) updateData['driverInfo.vehicleColor'] = vehicleColor;
    if (licenseNumber) updateData['driverInfo.licenseNumber'] = licenseNumber;
    if (licenseExpiry) updateData['driverInfo.licenseExpiry'] = new Date(licenseExpiry);

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
    console.error('Update driver profile error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update profile'
    });
  }
});

// Get earnings
router.get('/earnings', authenticateToken, requireDriver, async (req, res) => {
  try {
    const { period = 'week' } = req.query;
    const driverId = req.user._id;
    
    let startDate;
    const endDate = new Date();
    
    switch (period) {
      case 'today':
        startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate = new Date();
        startDate.setMonth(startDate.getMonth() - 1);
        break;
      case 'year':
        startDate = new Date();
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
    }

    // Get earnings breakdown
    const earnings = await Ride.aggregate([
      {
        $match: {
          driver: driverId,
          status: 'completed',
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
          },
          totalEarnings: { $sum: '$pricing.finalAmount' },
          totalRides: { $sum: 1 },
          averageFare: { $avg: '$pricing.finalAmount' }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    // Get total summary
    const summary = await Ride.aggregate([
      {
        $match: {
          driver: driverId,
          status: 'completed',
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$pricing.finalAmount' },
          totalRides: { $sum: 1 },
          averageFare: { $avg: '$pricing.finalAmount' }
        }
      }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        period,
        summary: summary[0] || { totalEarnings: 0, totalRides: 0, averageFare: 0 },
        dailyEarnings: earnings
      }
    });

  } catch (error) {
    console.error('Get earnings error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get earnings'
    });
  }
});

// Update bank details
router.patch('/bank-details', authenticateToken, requireDriver, async (req, res) => {
  try {
    const {
      accountNumber,
      ifscCode,
      accountHolderName,
      bankName
    } = req.body;

    const updateData = {};
    
    if (accountNumber) updateData['driverInfo.bankDetails.accountNumber'] = accountNumber;
    if (ifscCode) updateData['driverInfo.bankDetails.ifscCode'] = ifscCode;
    if (accountHolderName) updateData['driverInfo.bankDetails.accountHolderName'] = accountHolderName;
    if (bankName) updateData['driverInfo.bankDetails.bankName'] = bankName;

    await User.findByIdAndUpdate(req.user._id, updateData);

    res.status(200).json({
      status: 'success',
      message: 'Bank details updated successfully'
    });

  } catch (error) {
    console.error('Update bank details error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update bank details'
    });
  }
});

// Request withdrawal
router.post('/withdraw', authenticateToken, requireDriver, async (req, res) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid withdrawal amount'
      });
    }

    // Check if driver has sufficient earnings
    const totalEarnings = await Ride.aggregate([
      {
        $match: {
          driver: req.user._id,
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

    const availableAmount = totalEarnings[0]?.total || 0;
    
    if (amount > availableAmount) {
      return res.status(400).json({
        status: 'error',
        message: 'Insufficient earnings for withdrawal'
      });
    }

    // Create withdrawal request (you might want to create a separate Withdrawal model)
    const withdrawal = new Payment({
      user: req.user._id,
      type: 'withdrawal',
      amount: amount,
      method: 'bank_transfer',
      status: 'pending',
      description: 'Driver earnings withdrawal'
    });

    await withdrawal.save();

    res.status(200).json({
      status: 'success',
      message: 'Withdrawal request submitted successfully',
      data: {
        withdrawalId: withdrawal._id,
        amount: amount,
        status: 'pending'
      }
    });

  } catch (error) {
    console.error('Withdrawal request error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to process withdrawal request'
    });
  }
});

module.exports = router;
