const mongoose = require('mongoose');

const providerProfileSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  bio: {
    type: String,
    required: true
  },
  profilePicture: {
    type: String,  // URL to stored image
    required: true
  },
  services: [{
    type: String,
    enum: ['Makeup', 'Hair', 'Nails', 'Lashes'],  // Add all service types here
    required: true
  }],
  availability: [{
    date: {
      type: Date,
      required: true
    },
    timeSlots: [{
      startTime: {
        type: String,
        required: true
      },
      endTime: {
        type: String,
        required: true
      },
      isBooked: {
        type: Boolean,
        default: false
      }
    }]
  }],
  rating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  numberOfRatings: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('ProviderProfile', providerProfileSchema);