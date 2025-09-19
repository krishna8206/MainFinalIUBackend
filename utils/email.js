const nodemailer = require('nodemailer');

// Create transporter
const createTransporter = () => {
  return nodemailer.createTransporter({
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
};

// Send OTP email
const sendOTPEmail = async (email, otp, type = 'signup') => {
  try {
    const transporter = createTransporter();
    
    let subject, html;
    
    switch (type) {
      case 'signup':
        subject = 'Welcome to Idhar Udhar - Verify Your Email';
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #ff6b35, #f7931e); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">Idhar Udhar</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">Welcome to Idhar Udhar!</h2>
              <p style="color: #666; font-size: 16px;">Thank you for signing up. Please verify your email address using the OTP below:</p>
              <div style="background: #fff; border: 2px solid #ff6b35; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <h1 style="color: #ff6b35; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h1>
              </div>
              <p style="color: #666; font-size: 14px;">This OTP will expire in 10 minutes.</p>
              <p style="color: #666; font-size: 14px;">If you didn't request this, please ignore this email.</p>
            </div>
            <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
              <p>© 2024 Idhar Udhar. All rights reserved.</p>
            </div>
          </div>
        `;
        break;
        
      case 'login':
        subject = 'Idhar Udhar - Login OTP';
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #ff6b35, #f7931e); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">Idhar Udhar</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">Login OTP</h2>
              <p style="color: #666; font-size: 16px;">Use the following OTP to login to your account:</p>
              <div style="background: #fff; border: 2px solid #ff6b35; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <h1 style="color: #ff6b35; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h1>
              </div>
              <p style="color: #666; font-size: 14px;">This OTP will expire in 10 minutes.</p>
            </div>
            <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
              <p>© 2024 Idhar Udhar. All rights reserved.</p>
            </div>
          </div>
        `;
        break;
        
      case 'reset_password':
        subject = 'Idhar Udhar - Reset Password';
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #ff6b35, #f7931e); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">Idhar Udhar</h1>
            </div>
            <div style="padding: 30px; background: #f9f9f9;">
              <h2 style="color: #333;">Reset Your Password</h2>
              <p style="color: #666; font-size: 16px;">Use the following OTP to reset your password:</p>
              <div style="background: #fff; border: 2px solid #ff6b35; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                <h1 style="color: #ff6b35; font-size: 32px; margin: 0; letter-spacing: 5px;">${otp}</h1>
              </div>
              <p style="color: #666; font-size: 14px;">This OTP will expire in 10 minutes.</p>
            </div>
            <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
              <p>© 2024 Idhar Udhar. All rights reserved.</p>
            </div>
          </div>
        `;
        break;
    }
    
    const mailOptions = {
      from: `"Idhar Udhar" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: subject,
      html: html
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', result.messageId);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('Email sending failed:', error);
    return { success: false, error: error.message };
  }
};

// Send welcome email
const sendWelcomeEmail = async (email, fullName) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"Idhar Udhar" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Welcome to Idhar Udhar!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #ff6b35, #f7931e); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">Idhar Udhar</h1>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333;">Welcome ${fullName}!</h2>
            <p style="color: #666; font-size: 16px;">Your account has been successfully created and verified.</p>
            <p style="color: #666; font-size: 16px;">You can now start booking rides and enjoy our services.</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL}" style="background: #ff6b35; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Start Your Journey</a>
            </div>
          </div>
          <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
            <p>© 2024 Idhar Udhar. All rights reserved.</p>
          </div>
        </div>
      `
    };
    
    const result = await transporter.sendMail(mailOptions);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('Welcome email sending failed:', error);
    return { success: false, error: error.message };
  }
};

// Send ride confirmation email
const sendRideConfirmationEmail = async (email, rideDetails) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"Idhar Udhar" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Ride Confirmed - Idhar Udhar',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #ff6b35, #f7931e); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">Idhar Udhar</h1>
          </div>
          <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333;">Ride Confirmed!</h2>
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Ride ID:</strong> ${rideDetails.rideId}</p>
              <p><strong>Vehicle Type:</strong> ${rideDetails.rideType}</p>
              <p><strong>Pickup:</strong> ${rideDetails.pickup}</p>
              <p><strong>Destination:</strong> ${rideDetails.destination}</p>
              <p><strong>Fare:</strong> ₹${rideDetails.fare}</p>
              <p><strong>Driver:</strong> ${rideDetails.driverName}</p>
              <p><strong>Driver Phone:</strong> ${rideDetails.driverPhone}</p>
            </div>
            <p style="color: #666; font-size: 14px;">Your driver will arrive shortly. Thank you for choosing Idhar Udhar!</p>
          </div>
          <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
            <p>© 2024 Idhar Udhar. All rights reserved.</p>
          </div>
        </div>
      `
    };
    
    const result = await transporter.sendMail(mailOptions);
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    console.error('Ride confirmation email sending failed:', error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendOTPEmail,
  sendWelcomeEmail,
  sendRideConfirmationEmail
};
