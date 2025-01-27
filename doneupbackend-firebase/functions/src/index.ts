import { onRequest } from 'firebase-functions/v2/https';
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { User, ProviderProfile, Service, ProviderWithProfile, ProviderWithDistance } from './types';
import { Client, LatLng } from "@googlemaps/google-maps-services-js";
import { TravelMode } from "@googlemaps/google-maps-services-js";

admin.initializeApp();

const db = admin.firestore();
const googleMapsClient = new Client({});

  
// When a new user signs up
exports.onUserCreated = functions.auth.user().onCreate(async (user) => {
    const { email, uid } = user;

    // Create a user document - everyone starts as a customer
    await db.collection('users').doc(uid).set({
        email,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        isCustomer: true,  // Everyone is a customer by default
        isProvider: false, // Can become a provider later
        firstName: '',
        lastName: '',
        instagramHandle: '',
        location: null,
        profilePicture: ''
    });
});

// Create/Update provider profile
exports.createProviderProfile = onRequest(async (request, response) => {
    try {
        // Get the Firebase ID token from the Authorization header
        const idToken = request.headers.authorization?.split('Bearer ')[1];
        if (!idToken) {
            response.status(401).json({ error: 'Unauthorized' });
            return;
        }

        // Verify the token
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const uid = decodedToken.uid;

        const { bio, services } = request.body;

        // Update user to be a provider
        await db.collection('users').doc(uid).update({
            isProvider: true
        });

        // Create or update provider profile
        await db.collection('providerProfiles').doc(uid).set({
            userId: uid,
            bio,
            services,
            availability: [],
            rating: 0,
            numberOfRatings: 0,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true }); // merge: true will update existing doc if it exists

        response.json({ success: true });
    } catch (error) {
        console.error('Error:', error);
        response.status(500).json({ error: 'Internal server error' });
    }
});

exports.searchProviders = onRequest(async (request, response) => {
  try {
    // Auth check
    const idToken = request.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      response.status(401).json({ error: 'Unauthorized' });
      return;
    }

    await admin.auth().verifyIdToken(idToken);
    
    // Get search parameters
    const { service, latitude, longitude } = request.query;
    const radiusInKm = request.query.radiusInKm ? Number(request.query.radiusInKm) : 50;

    if (!service || !latitude || !longitude) {
      response.status(400).json({ 
        error: 'Missing required parameters: service, latitude, longitude' 
      });
      return;
    }

    // Get all providers who offer this service
    const providersSnapshot = await db.collection('users')
      .where('isProvider', '==', true)
      .get();

    const providers = await Promise.all(
      providersSnapshot.docs.map(async (doc) => {
        const providerProfileDoc = await db.collection('providerProfiles')
          .doc(doc.id)
          .get();
        
        return {
          userId: doc.id,
          userData: doc.data() as User,
          profileData: providerProfileDoc.data() as ProviderProfile
        };
      })
    );

    // Filter providers who offer the service and have a location
    const validProviders = providers.filter(provider => 
      provider.profileData?.services.includes(service as Service) &&
      provider.userData?.location
    );

    // Use Google Maps Distance Matrix API to get real distances
    if (validProviders.length > 0) {
      const origins: LatLng[] = [{ lat: Number(latitude), lng: Number(longitude) }];
      const destinations: LatLng[] = validProviders.map(provider => ({
        lat: provider.userData.location!.latitude,
        lng: provider.userData.location!.longitude
      }));

      const distanceMatrix = await googleMapsClient.distancematrix({
        params: {
          origins,
          destinations,
          mode: TravelMode.driving,
          key: process.env.GOOGLE_MAPS_API_KEY!
        }
      });

      // Add distances to providers
      const providersWithDistance = validProviders.map((provider, index) => ({
        ...provider,
        distance: distanceMatrix.data.rows[0].elements[index].distance.value / 1000, // Convert to km
        duration: distanceMatrix.data.rows[0].elements[index].duration.text
      }));

      // Filter by radius and sort by distance
      const filteredProviders = providersWithDistance
        .filter(provider => provider.distance <= radiusInKm)
        .sort((a, b) => a.distance - b.distance);

      response.json({ 
        providers: filteredProviders.map(provider => ({
          ...provider,
          distance: Math.round(provider.distance * 10) / 10, // Round to 1 decimal
          distanceText: `${Math.round(provider.distance * 10) / 10} km`
        }))
      });
    } else {
      response.json({ providers: [] });
    }

  } catch (error: unknown) {
    console.error('Error:', error);
    response.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to calculate distance between two points
function calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
): number {
    const R = 6371; // Earth's radius in kilometers
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRad(degrees: number): number {
    return degrees * (Math.PI / 180);
}

// Add these helper functions
function isValidTimeFormat(time: string): boolean {
    return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time);
}

function isDateInPast(date: Date): boolean {
    return date < new Date();
}

function isWithinBookingWindow(date: Date, maxDaysInAdvance: number = 90): boolean {
    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + maxDaysInAdvance);
    return date <= maxDate;
}

exports.createBooking = onRequest(async (request, response) => {
    try {
        // Auth check
        const idToken = request.headers.authorization?.split('Bearer ')[1];
        if (!idToken) {
            response.status(401).json({ error: 'Unauthorized' });
            return;
        }

        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const customerId = decodedToken.uid;

        // Input validation
        const { providerId, service, dateTime, location } = request.body;

        if (!providerId || !service || !dateTime || !location) {
            response.status(400).json({ error: 'Missing required fields' });
            return;
        }

        // Validate customer isn't booking themselves
        if (customerId === providerId) {
            response.status(400).json({ error: 'Cannot book yourself' });
            return;
        }

        // Date/Time validation
        const requestedDate = new Date(dateTime);

        if (isNaN(requestedDate.getTime())) {
            response.status(400).json({ error: 'Invalid date format' });
            return;
        }

        if (isDateInPast(requestedDate)) {
            response.status(400).json({ error: 'Cannot book appointments in the past' });
            return;
        }

        if (!isWithinBookingWindow(requestedDate)) {
            response.status(400).json({ error: 'Booking too far in advance' });
            return;
        }

        // Location validation
        if (!location.latitude || !location.longitude || !location.address) {
            response.status(400).json({ error: 'Invalid location format' });
            return;
        }

        // Check if customer already has a booking at this time
        const existingBookings = await db.collection('bookings')
            .where('customerId', '==', customerId)
            .where('dateTime', '==', admin.firestore.Timestamp.fromDate(requestedDate))
            .where('status', 'in', ['pending', 'confirmed'])
            .get();

        if (!existingBookings.empty) {
            response.status(400).json({ error: 'You already have a booking at this time' });
            return;
        }

        // Provider checks
        const providerDoc = await db.collection('users').doc(providerId).get();
        if (!providerDoc.exists || !providerDoc.data()?.isProvider) {
            response.status(400).json({ error: 'Invalid provider' });
            return;
        }

        const providerProfileDoc = await db.collection('providerProfiles').doc(providerId).get();
        if (!providerProfileDoc.exists) {
            response.status(400).json({ error: 'Provider profile not found' });
            return;
        }

        const providerProfile = providerProfileDoc.data() as ProviderProfile;

        if (!providerProfile.services.includes(service as Service)) {
            response.status(400).json({ error: 'Provider does not offer this service' });
            return;
        }

        // Availability check
        const requestedDateString = requestedDate.toISOString().split('T')[0];
        const requestedTime = requestedDate.toTimeString().split(' ')[0];

        if (!isValidTimeFormat(requestedTime)) {
            response.status(400).json({ error: 'Invalid time format' });
            return;
        }

        const matchingAvailability = providerProfile.availability.find(avail => {
            const availDate = avail.date.toDate();
            return availDate.toISOString().split('T')[0] === requestedDateString;
        });

        if (!matchingAvailability) {
            response.status(400).json({ error: 'Provider is not available on this date' });
            return;
        }

        const availableTimeSlot = matchingAvailability.timeSlots.find(slot =>
            slot.startTime === requestedTime && !slot.isBooked
        );

        if (!availableTimeSlot) {
            response.status(400).json({ error: 'This time slot is not available' });
            return;
        }

        // Create booking with transaction
        const bookingId = await db.runTransaction(async (transaction) => {
            // Double-check availability hasn't changed
            const freshProviderProfile = await transaction.get(db.collection('providerProfiles').doc(providerId));
            const freshAvailability = (freshProviderProfile.data() as ProviderProfile).availability;

            const isStillAvailable = freshAvailability.some(avail =>
                avail.date.toDate().toISOString().split('T')[0] === requestedDateString &&
                avail.timeSlots.some(slot => slot.startTime === requestedTime && !slot.isBooked)
            );

            if (!isStillAvailable) {
                throw new Error('Time slot no longer available');
            }

            // Update provider's availability
            const updatedAvailability = freshAvailability.map(avail => {
                if (avail.date.toDate().toISOString().split('T')[0] === requestedDateString) {
                    return {
                        ...avail,
                        timeSlots: avail.timeSlots.map(slot =>
                            slot.startTime === requestedTime ? { ...slot, isBooked: true } : slot
                        )
                    };
                }
                return avail;
            });

            transaction.update(db.collection('providerProfiles').doc(providerId), {
                availability: updatedAvailability
            });

            // Create the booking
            const bookingRef = db.collection('bookings').doc();
            const booking = {
                id: bookingRef.id,
                customerId,
                providerId,
                service,
                dateTime: admin.firestore.Timestamp.fromDate(requestedDate),
                status: 'pending',
                location,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            };

            transaction.set(bookingRef, booking);
            return bookingRef.id;
        });

        response.json({
            success: true,
            bookingId
        });

        // ... rest of the code stays the same until the catch block ...

    } catch (error: unknown) {
        console.error('Error:', error);
        if (error instanceof Error) {
            if (error.message === 'Time slot no longer available') {
                response.status(409).json({ error: 'Time slot was just booked by someone else' });
            } else {
                response.status(500).json({ error: 'Internal server error' });
            }
        } else {
            response.status(500).json({ error: 'Internal server error' });
        }
    }
});