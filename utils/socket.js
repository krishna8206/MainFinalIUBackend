const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Initialize Socket.IO handlers
const initializeSocket = (io) => {
  // Authentication middleware for Socket.IO
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
      
      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId).select('-wallet.transactions');
      
      if (!user || !user.isActive) {
        return next(new Error('Authentication error: Invalid user'));
      }

      socket.userId = user._id.toString();
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`User ${socket.user.fullName} connected with socket ID: ${socket.id}`);

    // Join user to their personal room
    socket.join(`user_${socket.userId}`);

    // Join driver to driver room if they are a driver
    if (socket.user.role === 'Driver') {
      socket.join('drivers');
      console.log(`Driver ${socket.user.fullName} joined drivers room`);
    }

    // Handle ride request acceptance
    socket.on('accept-ride', async (data) => {
      try {
        const { rideId } = data;
        
        // Emit to all drivers that this ride is no longer available
        socket.to('drivers').emit('ride-accepted', { rideId });
        
        console.log(`Driver ${socket.user.fullName} accepted ride ${rideId}`);
      } catch (error) {
        console.error('Accept ride socket error:', error);
        socket.emit('error', { message: 'Failed to accept ride' });
      }
    });

    // Handle driver location updates
    socket.on('update-location', async (data) => {
      try {
        const { longitude, latitude, rideId } = data;
        
        if (socket.user.role !== 'Driver') {
          return socket.emit('error', { message: 'Only drivers can update location' });
        }

        // Update driver location in database
        await User.findByIdAndUpdate(socket.userId, {
          'driverInfo.currentLocation.coordinates': [longitude, latitude]
        });

        // If this is during an active ride, emit to the user
        if (rideId) {
          socket.to(`ride_${rideId}`).emit('driver-location-update', {
            driverId: socket.userId,
            location: { longitude, latitude },
            timestamp: new Date()
          });
        }

        // Emit to all users looking for nearby drivers
        socket.broadcast.emit('driver-location-update', {
          driverId: socket.userId,
          location: { longitude, latitude },
          timestamp: new Date()
        });

      } catch (error) {
        console.error('Update location socket error:', error);
        socket.emit('error', { message: 'Failed to update location' });
      }
    });

    // Handle ride status updates
    socket.on('ride-status-update', async (data) => {
      try {
        const { rideId, status } = data;
        
        // Emit to the user of this ride
        socket.to(`user_${data.userId}`).emit('ride-status-update', {
          rideId,
          status,
          timestamp: new Date()
        });

        console.log(`Ride ${rideId} status updated to ${status}`);
      } catch (error) {
        console.error('Ride status update socket error:', error);
        socket.emit('error', { message: 'Failed to update ride status' });
      }
    });

    // Handle joining ride room
    socket.on('join-ride', (data) => {
      const { rideId } = data;
      socket.join(`ride_${rideId}`);
      console.log(`User ${socket.user.fullName} joined ride room ${rideId}`);
    });

    // Handle leaving ride room
    socket.on('leave-ride', (data) => {
      const { rideId } = data;
      socket.leave(`ride_${rideId}`);
      console.log(`User ${socket.user.fullName} left ride room ${rideId}`);
    });

    // Handle driver availability updates
    socket.on('update-availability', async (data) => {
      try {
        const { isAvailable } = data;
        
        if (socket.user.role !== 'Driver') {
          return socket.emit('error', { message: 'Only drivers can update availability' });
        }

        // Update driver availability in database
        await User.findByIdAndUpdate(socket.userId, {
          'driverInfo.isAvailable': isAvailable
        });

        // Emit to all users looking for drivers
        socket.broadcast.emit('driver-availability-update', {
          driverId: socket.userId,
          isAvailable,
          timestamp: new Date()
        });

        console.log(`Driver ${socket.user.fullName} availability updated to ${isAvailable}`);
      } catch (error) {
        console.error('Update availability socket error:', error);
        socket.emit('error', { message: 'Failed to update availability' });
      }
    });

    // Handle emergency alerts
    socket.on('emergency-alert', async (data) => {
      try {
        const { rideId, location, message } = data;
        
        // Emit to admin users
        socket.to('admins').emit('emergency-alert', {
          rideId,
          userId: socket.userId,
          user: socket.user.fullName,
          location,
          message,
          timestamp: new Date()
        });

        // Also emit to nearby drivers
        socket.to('drivers').emit('emergency-alert', {
          rideId,
          userId: socket.userId,
          location,
          message,
          timestamp: new Date()
        });

        console.log(`Emergency alert from user ${socket.user.fullName} for ride ${rideId}`);
      } catch (error) {
        console.error('Emergency alert socket error:', error);
        socket.emit('error', { message: 'Failed to send emergency alert' });
      }
    });

    // Handle chat messages (if you implement in-app chat)
    socket.on('send-message', (data) => {
      const { rideId, message } = data;
      
      // Emit message to all users in the ride room
      io.to(`ride_${rideId}`).emit('new-message', {
        userId: socket.userId,
        userName: socket.user.fullName,
        message,
        timestamp: new Date()
      });
    });

    // Handle typing indicators
    socket.on('typing', (data) => {
      const { rideId, isTyping } = data;
      
      socket.to(`ride_${rideId}`).emit('user-typing', {
        userId: socket.userId,
        userName: socket.user.fullName,
        isTyping
      });
    });

    // Handle disconnect
    socket.on('disconnect', async () => {
      try {
        console.log(`User ${socket.user.fullName} disconnected`);
        
        // Update user's online status
        await User.findByIdAndUpdate(socket.userId, {
          isOnline: false,
          lastSeen: new Date()
        });

        // If driver, update availability
        if (socket.user.role === 'Driver') {
          await User.findByIdAndUpdate(socket.userId, {
            'driverInfo.isAvailable': false
          });
        }

      } catch (error) {
        console.error('Disconnect error:', error);
      }
    });

    // Handle errors
    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  // Broadcast ride requests to nearby drivers
  const broadcastRideRequest = (rideData) => {
    io.to('drivers').emit('new-ride-request', rideData);
  };

  // Send notification to specific user
  const sendNotificationToUser = (userId, notification) => {
    io.to(`user_${userId}`).emit('notification', notification);
  };

  // Broadcast to all users
  const broadcastToAll = (event, data) => {
    io.emit(event, data);
  };

  // Broadcast to all drivers
  const broadcastToDrivers = (event, data) => {
    io.to('drivers').emit(event, data);
  };

  // Broadcast to all admins
  const broadcastToAdmins = (event, data) => {
    io.to('admins').emit(event, data);
  };

  return {
    broadcastRideRequest,
    sendNotificationToUser,
    broadcastToAll,
    broadcastToDrivers,
    broadcastToAdmins
  };
};

module.exports = {
  initializeSocket
};
