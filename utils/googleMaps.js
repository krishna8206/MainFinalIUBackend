const axios = require('axios');

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GOOGLE_MAPS_BASE_URL = 'https://maps.googleapis.com/maps/api';

// Get distance and duration between two points
const getDistanceAndDuration = async (origin, destination, mode = 'driving') => {
  try {
    const response = await axios.get(`${GOOGLE_MAPS_BASE_URL}/distancematrix/json`, {
      params: {
        origins: `${origin.lat},${origin.lng}`,
        destinations: `${destination.lat},${destination.lng}`,
        mode: mode,
        units: 'metric',
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status === 'OK' && response.data.rows[0].elements[0].status === 'OK') {
      const element = response.data.rows[0].elements[0];
      return {
        success: true,
        distance: element.distance.value / 1000, // Convert to kilometers
        duration: element.duration.value / 60, // Convert to minutes
        distanceText: element.distance.text,
        durationText: element.duration.text
      };
    } else {
      return {
        success: false,
        error: 'Unable to calculate distance and duration'
      };
    }
  } catch (error) {
    console.error('Google Maps distance matrix error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Get directions with waypoints
const getDirections = async (origin, destination, waypoints = [], mode = 'driving') => {
  try {
    const params = {
      origin: `${origin.lat},${origin.lng}`,
      destination: `${destination.lat},${destination.lng}`,
      mode: mode,
      key: GOOGLE_MAPS_API_KEY
    };

    if (waypoints.length > 0) {
      params.waypoints = waypoints.map(wp => `${wp.lat},${wp.lng}`).join('|');
    }

    const response = await axios.get(`${GOOGLE_MAPS_BASE_URL}/directions/json`, {
      params: params
    });

    if (response.data.status === 'OK' && response.data.routes.length > 0) {
      const route = response.data.routes[0];
      const leg = route.legs[0];
      
      return {
        success: true,
        distance: leg.distance.value / 1000, // Convert to kilometers
        duration: leg.duration.value / 60, // Convert to minutes
        polyline: route.overview_polyline.points,
        steps: leg.steps.map(step => ({
          instruction: step.html_instructions,
          distance: step.distance.value / 1000,
          duration: step.duration.value / 60,
          startLocation: {
            lat: step.start_location.lat,
            lng: step.start_location.lng
          },
          endLocation: {
            lat: step.end_location.lat,
            lng: step.end_location.lng
          }
        }))
      };
    } else {
      return {
        success: false,
        error: 'Unable to get directions'
      };
    }
  } catch (error) {
    console.error('Google Maps directions error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Geocode address to coordinates
const geocodeAddress = async (address) => {
  try {
    const response = await axios.get(`${GOOGLE_MAPS_BASE_URL}/geocode/json`, {
      params: {
        address: address,
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      return {
        success: true,
        address: result.formatted_address,
        coordinates: {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng
        },
        placeId: result.place_id,
        types: result.types
      };
    } else {
      return {
        success: false,
        error: 'Address not found'
      };
    }
  } catch (error) {
    console.error('Google Maps geocoding error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Reverse geocode coordinates to address
const reverseGeocode = async (lat, lng) => {
  try {
    const response = await axios.get(`${GOOGLE_MAPS_BASE_URL}/geocode/json`, {
      params: {
        latlng: `${lat},${lng}`,
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status === 'OK' && response.data.results.length > 0) {
      const result = response.data.results[0];
      return {
        success: true,
        address: result.formatted_address,
        placeId: result.place_id,
        types: result.types,
        components: result.address_components
      };
    } else {
      return {
        success: false,
        error: 'Location not found'
      };
    }
  } catch (error) {
    console.error('Google Maps reverse geocoding error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Get nearby places
const getNearbyPlaces = async (lat, lng, type = 'establishment', radius = 1000) => {
  try {
    const response = await axios.get(`${GOOGLE_MAPS_BASE_URL}/place/nearbysearch/json`, {
      params: {
        location: `${lat},${lng}`,
        radius: radius,
        type: type,
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status === 'OK') {
      return {
        success: true,
        places: response.data.results.map(place => ({
          name: place.name,
          address: place.vicinity,
          coordinates: {
            lat: place.geometry.location.lat,
            lng: place.geometry.location.lng
          },
          placeId: place.place_id,
          rating: place.rating,
          types: place.types
        }))
      };
    } else {
      return {
        success: false,
        error: 'Unable to find nearby places'
      };
    }
  } catch (error) {
    console.error('Google Maps nearby places error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Get place details
const getPlaceDetails = async (placeId) => {
  try {
    const response = await axios.get(`${GOOGLE_MAPS_BASE_URL}/place/details/json`, {
      params: {
        place_id: placeId,
        fields: 'name,formatted_address,geometry,formatted_phone_number,website,rating,reviews,photos',
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status === 'OK') {
      const place = response.data.result;
      return {
        success: true,
        place: {
          name: place.name,
          address: place.formatted_address,
          coordinates: {
            lat: place.geometry.location.lat,
            lng: place.geometry.location.lng
          },
          phone: place.formatted_phone_number,
          website: place.website,
          rating: place.rating,
          reviews: place.reviews,
          photos: place.photos
        }
      };
    } else {
      return {
        success: false,
        error: 'Place not found'
      };
    }
  } catch (error) {
    console.error('Google Maps place details error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Autocomplete places
const autocompletePlaces = async (input, location = null, radius = 50000) => {
  try {
    const params = {
      input: input,
      key: GOOGLE_MAPS_API_KEY,
      types: 'establishment|geocode'
    };

    if (location) {
      params.location = `${location.lat},${location.lng}`;
      params.radius = radius;
    }

    const response = await axios.get(`${GOOGLE_MAPS_BASE_URL}/place/autocomplete/json`, {
      params: params
    });

    if (response.data.status === 'OK') {
      return {
        success: true,
        predictions: response.data.predictions.map(prediction => ({
          description: prediction.description,
          placeId: prediction.place_id,
          types: prediction.types
        }))
      };
    } else {
      return {
        success: false,
        error: 'Unable to get autocomplete suggestions'
      };
    }
  } catch (error) {
    console.error('Google Maps autocomplete error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Calculate fare based on distance and time
const calculateFare = (distance, duration, vehicleType, surgeMultiplier = 1) => {
  const baseFares = {
    'Bike': { base: 20, perKm: 8, perMin: 1 },
    'Auto': { base: 30, perKm: 12, perMin: 1.5 },
    'Car': { base: 50, perKm: 15, perMin: 2 },
    'Truck': { base: 100, perKm: 25, perMin: 3 }
  };

  const rates = baseFares[vehicleType] || baseFares['Car'];
  
  const baseFare = rates.base;
  const distanceFare = distance * rates.perKm;
  const timeFare = duration * rates.perMin;
  
  const totalFare = (baseFare + distanceFare + timeFare) * surgeMultiplier;
  
  return {
    baseFare,
    distanceFare: Math.round(distanceFare * 100) / 100,
    timeFare: Math.round(timeFare * 100) / 100,
    totalFare: Math.round(totalFare * 100) / 100,
    surgeMultiplier
  };
};

// Get current traffic conditions
const getTrafficConditions = async (origin, destination) => {
  try {
    const response = await axios.get(`${GOOGLE_MAPS_BASE_URL}/distancematrix/json`, {
      params: {
        origins: `${origin.lat},${origin.lng}`,
        destinations: `${destination.lat},${destination.lng}`,
        mode: 'driving',
        departure_time: 'now',
        traffic_model: 'best_guess',
        units: 'metric',
        key: GOOGLE_MAPS_API_KEY
      }
    });

    if (response.data.status === 'OK' && response.data.rows[0].elements[0].status === 'OK') {
      const element = response.data.rows[0].elements[0];
      const durationInTraffic = element.duration_in_traffic ? element.duration_in_traffic.value / 60 : null;
      const normalDuration = element.duration.value / 60;
      
      return {
        success: true,
        normalDuration,
        durationInTraffic,
        trafficDelay: durationInTraffic ? durationInTraffic - normalDuration : 0,
        trafficLevel: durationInTraffic ? 
          (durationInTraffic > normalDuration * 1.5 ? 'heavy' : 
           durationInTraffic > normalDuration * 1.2 ? 'moderate' : 'light') : 'unknown'
      };
    } else {
      return {
        success: false,
        error: 'Unable to get traffic conditions'
      };
    }
  } catch (error) {
    console.error('Google Maps traffic conditions error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  getDistanceAndDuration,
  getDirections,
  geocodeAddress,
  reverseGeocode,
  getNearbyPlaces,
  getPlaceDetails,
  autocompletePlaces,
  calculateFare,
  getTrafficConditions
};
