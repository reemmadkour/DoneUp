import { Timestamp } from 'firebase-admin/firestore';

export interface User {
  email: string;
  isCustomer: boolean;
  isProvider: boolean;
  firstName: string;
  lastName: string;
  instagramHandle: string;
  location: {
    latitude: number;
    longitude: number;
  } | null;
  profilePicture: string;
  createdAt: Timestamp;
}

export interface ProviderProfile {
  userId: string;
  bio: string;
  services: Service[];
  availability: Availability[];
  rating: number;
  numberOfRatings: number;
  createdAt: Timestamp;
}

export interface Availability {
  date: Timestamp;
  timeSlots: TimeSlot[];
}

export interface TimeSlot {
  startTime: string;
  endTime: string;
  isBooked: boolean;
}

export interface ProviderWithProfile {
  userId: string;
  userData: User;
  profileData: ProviderProfile;
}

export interface ProviderWithDistance extends ProviderWithProfile {
  distance: number;
  duration: string;
}

export type Service = 'Makeup' | 'Hair' | 'Nails' | 'Lashes';
export type BookingStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';