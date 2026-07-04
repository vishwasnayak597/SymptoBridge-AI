import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import {
  MapPinIcon,
  PhoneIcon,
  StarIcon,
  ClockIcon,
  CalendarDaysIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  VideoCameraIcon,
  BuildingOffice2Icon,
  AcademicCapIcon,
  UserGroupIcon,
  MapIcon,
  ListBulletIcon,
  CurrencyDollarIcon,
  SparklesIcon
} from '@heroicons/react/24/outline';
import { StarIcon as StarIconSolid } from '@heroicons/react/24/solid';
import { apiClient } from '../lib/api';

// Dynamic import with SSR disabled for Leaflet
const DoctorMap = dynamic(() => import('./DoctorMap'), {
  ssr: false,
  loading: () => (
    <div className="h-96 w-full rounded-lg overflow-hidden shadow-lg bg-gray-100 flex items-center justify-center">
      <div className="text-center">
        <MapPinIcon className="h-12 w-12 text-gray-400 mx-auto mb-2" />
        <p className="text-gray-600">Loading map...</p>
      </div>
    </div>
  )
});

interface Doctor {
  id: string;
  name: string;
  specialization: string;
  rating: number;
  reviewCount: number;
  experience: number;
  consultationFee: number;
  avatar?: string;
  bio: string;
  location: {
    address: string;
    city: string;
    distance: number;
    coordinates: {
      lat: number;
      lng: number;
    };
  };
  availability: {
    nextAvailable: string;
    isOnline: boolean;
    timeSlots: string[];
  };
  credentials: string[];
  languages: string[];
}

interface DoctorSearchProps {
  initialSearchTerm?: string;
  onBookAppointment?: (doctor: Doctor) => void;
  recommendedSpecializations?: string[];
}

const SPECIALIZATIONS = [
  'All Specializations',
  'General Practice',
  'Cardiology',
  'Dermatology',
  'Pediatrics',
  'Orthopedics',
  'Neurology',
  'Psychiatry',
  'Gynecology',
  'Ophthalmology',
  'Gastroenterology',
  'Pulmonology',
  'Endocrinology',
  'Rheumatology',
  'Urology',
  'Oncology'
];

const DoctorSearch: React.FC<DoctorSearchProps> = ({ 
  initialSearchTerm = '',
  onBookAppointment,
  recommendedSpecializations = []
}) => {
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
  const [selectedSpecialization, setSelectedSpecialization] = useState('All Specializations');
  const [sortBy, setSortBy] = useState('distance');
  const [showOnlineOnly, setShowOnlineOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list');
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [filteredDoctors, setFilteredDoctors] = useState<Doctor[]>([]);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch doctors from API (with real geospatial distance when location is known)
  useEffect(() => {
    const fetchDoctors = async () => {
      try {
        setLoading(true);
        setError(null);

        // With coordinates, the backend runs a $geoNear query and returns true distanceKm.
        const geoQuery = userLocation ? `?lat=${userLocation.lat}&lng=${userLocation.lng}` : '';
        const response = await apiClient.get(`/users/doctors${geoQuery}`);

        if (response.status !== 200) {
          throw new Error('Failed to fetch doctors');
        }

        const data = response.data;

        // Transform API data to match our Doctor interface
        const transformedDoctors: Doctor[] = data.data?.map((doc: any) => ({
          id: doc._id,
          name: `Dr. ${doc.firstName} ${doc.lastName}`,
          specialization: doc.specialization || 'General Practice',
          rating: doc.rating || 4.5,
          reviewCount: doc.reviewCount || 0,
          experience: doc.experience || 0,
          consultationFee: doc.consultationFee || 500,
          bio: doc.bio || 'Experienced medical practitioner dedicated to providing quality healthcare.',
          location: {
            address: doc.location?.address || doc.address?.street || 'Medical Center',
            city: doc.location?.city || doc.address?.city || 'Mumbai',
            // Real distance computed by MongoDB's 2dsphere $geoNear (null when unknown)
            distance: typeof doc.distanceKm === 'number' ? doc.distanceKm : Number.POSITIVE_INFINITY,
            coordinates: {
              lat: doc.location?.geo?.coordinates?.[1] || doc.location?.coordinates?.latitude || 19.0760,
              lng: doc.location?.geo?.coordinates?.[0] || doc.location?.coordinates?.longitude || 72.8777
            }
          },
          availability: {
            nextAvailable: 'Available Today',
            isOnline: doc.isOnline || false,
            timeSlots: ['10:00 AM', '2:00 PM', '4:00 PM']
          },
          credentials: doc.credentials || ['MD'],
          languages: doc.languages || ['English']
        })) || [];

        // If no doctors from API, use mock data
        if (transformedDoctors.length === 0) {
          // setDoctors(MOCK_DOCTORS); // This line is removed as per the edit hint
        } else {
          setDoctors(transformedDoctors);
        }
      } catch (error) {
        console.error('Error fetching doctors:', error);
        setError('Failed to load doctors. Using sample data.');
        // setDoctors(MOCK_DOCTORS); // This line is removed as per the edit hint
      } finally {
        setLoading(false);
      }
    };

    fetchDoctors();
  }, [userLocation]); // refetch with geo query once the browser shares location

  // Get user location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
        }
      );
    }
  }, []);

  // Filter and sort doctors
  useEffect(() => {
    let filtered = doctors.filter(doctor => {
      const matchesSearch = doctor.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           doctor.specialization.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSpecialization = selectedSpecialization === 'All Specializations' ||
                                   doctor.specialization === selectedSpecialization;
      const matchesOnlineFilter = !showOnlineOnly || doctor.availability.isOnline;
      
      return matchesSearch && matchesSpecialization && matchesOnlineFilter;
    });

    // Sort doctors with priority for recommended specializations
    filtered.sort((a, b) => {
      // First, prioritize doctors with recommended specializations
      const aIsRecommended = recommendedSpecializations.length > 0 && 
                            recommendedSpecializations.some(spec => 
                              a.specialization.toLowerCase().includes(spec.toLowerCase()) ||
                              spec.toLowerCase().includes(a.specialization.toLowerCase())
                            );
      const bIsRecommended = recommendedSpecializations.length > 0 && 
                            recommendedSpecializations.some(spec => 
                              b.specialization.toLowerCase().includes(spec.toLowerCase()) ||
                              spec.toLowerCase().includes(b.specialization.toLowerCase())
                            );

      if (aIsRecommended && !bIsRecommended) return -1;
      if (!aIsRecommended && bIsRecommended) return 1;

      // Then sort by selected criteria
      switch (sortBy) {
        case 'distance':
          return a.location.distance - b.location.distance;
        case 'rating':
          return b.rating - a.rating;
        case 'price':
          return a.consultationFee - b.consultationFee;
        default:
          return 0;
      }
    });

    setFilteredDoctors(filtered);
  }, [searchTerm, selectedSpecialization, sortBy, showOnlineOnly, doctors, recommendedSpecializations]);

  const renderStars = (rating: number) => {
    const stars = [];
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 !== 0;

    for (let i = 0; i < fullStars; i++) {
      stars.push(
        <StarIconSolid key={i} className="h-4 w-4 text-yellow-400" />
      );
    }

    if (hasHalfStar) {
      stars.push(
        <StarIcon key="half" className="h-4 w-4 text-yellow-400" />
      );
    }

    const remainingStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
    for (let i = 0; i < remainingStars; i++) {
      stars.push(
        <StarIcon key={`empty-${i}`} className="h-4 w-4 text-gray-300" />
      );
    }

    return stars;
  };

  const handleBookAppointment = (doctor: Doctor) => {
    if (onBookAppointment) {
      onBookAppointment(doctor);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Loading doctors...</h3>
          <p className="text-gray-600">Finding the best medical professionals for you</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">Find Your Doctor</h2>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          Connect with qualified healthcare professionals near you
        </p>
        {recommendedSpecializations.length > 0 && (
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <SparklesIcon className="h-5 w-5 text-blue-600 mr-2" />
              <span className="text-blue-800 font-semibold">AI Recommended Specializations</span>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {recommendedSpecializations.map((spec, index) => (
                <span key={index} className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full">
                  {spec}
                </span>
              ))}
            </div>
            <p className="text-blue-700 text-sm mt-2">
              💡 Doctors matching these specializations are shown first based on your symptoms
            </p>
          </div>
        )}
        {error && (
          <div className="mt-4 p-3 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded-lg">
            {error}
          </div>
        )}
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {/* Search */}
          <div className="relative">
            <MagnifyingGlassIcon className="h-5 w-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search doctors or specializations..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Specialization Filter */}
          <select
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={selectedSpecialization}
            onChange={(e) => setSelectedSpecialization(e.target.value)}
          >
            {SPECIALIZATIONS.map(spec => (
              <option key={spec} value={spec}>{spec}</option>
            ))}
          </select>

          {/* Sort By */}
          <select
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="distance">Sort by Distance</option>
            <option value="rating">Sort by Rating</option>
            <option value="price">Sort by Price</option>
          </select>

          {/* Online Only Filter */}
          <label className="flex items-center space-x-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={showOnlineOnly}
              onChange={(e) => setShowOnlineOnly(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>Online consultation only</span>
          </label>
        </div>

        {/* View Toggle and Results Count */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {filteredDoctors.length} doctor{filteredDoctors.length !== 1 ? 's' : ''} found
          </p>
          
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg ${viewMode === 'list' ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <ListBulletIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`p-2 rounded-lg ${viewMode === 'map' ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
            >
              <MapIcon className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {viewMode === 'list' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {filteredDoctors.length > 0 ? (
          filteredDoctors.map((doctor) => (
            <div key={doctor.id} className="card hover-lift">
              <div className="card-body">
                {/* Doctor Header */}
                <div className="flex items-start space-x-4 mb-4">
                  <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-full flex items-center justify-center">
                    <span className="text-white font-semibold text-lg">
                      {doctor.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </span>
                  </div>
                  
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">{doctor.name}</h3>
                    <p className="text-blue-600 font-medium">{doctor.specialization}</p>
                    
                    {/* Rating */}
                    <div className="flex items-center mt-2">
                      <div className="flex items-center mr-2">
                        {renderStars(doctor.rating)}
                      </div>
                      <span className="text-sm text-gray-600">
                        {doctor.rating} ({doctor.reviewCount} reviews)
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bio */}
                <p className="text-gray-600 text-sm mb-4 line-clamp-2">{doctor.bio}</p>

                {/* Details */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Experience:</p>
                    <p className="text-sm font-semibold text-gray-900">{doctor.experience} years</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Next Available:</p>
                    <p className="text-sm font-semibold text-green-600">{doctor.availability.nextAvailable}</p>
                  </div>
                </div>

                {/* Location */}
                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-1">Location:</p>
                  <div className="flex items-center">
                    <MapPinIcon className="h-4 w-4 text-gray-400 mr-1" />
                    <span className="text-sm text-gray-600">
                      {doctor.location.address}, {doctor.location.city}
                    </span>
                    {Number.isFinite(doctor.location.distance) && (
                      <span className="text-xs text-gray-500 ml-2">
                        ({doctor.location.distance.toFixed(1)} km away)
                      </span>
                    )}
                  </div>
                </div>

                {/* Credentials */}
                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-1">Credentials:</p>
                  <div className="flex flex-wrap gap-1">
                    {doctor.credentials.map((credential, index) => (
                      <span
                        key={index}
                        className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded"
                      >
                        {credential}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Languages */}
                <div className="mb-4">
                  <p className="text-xs text-gray-500 mb-1">Languages:</p>
                  <div className="flex flex-wrap gap-1">
                    {doctor.languages.map((language, index) => (
                      <span
                        key={index}
                        className="bg-gray-100 text-gray-700 text-xs px-2 py-1 rounded"
                      >
                        {language}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between pt-4 border-t border-gray-200">
                  <div className="text-lg font-semibold text-gray-900">
                    ₹{doctor.consultationFee}
                    <span className="text-sm font-normal text-gray-600"> /consultation</span>
                  </div>
                  
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleBookAppointment(doctor)}
                      className="btn-primary flex items-center text-sm"
                    >
                      <CalendarDaysIcon className="h-4 w-4 mr-1" />
                      Book Now
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-2">
            <div className="text-center py-12">
              <UserGroupIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No doctors found</h3>
              <p className="text-gray-600">Try adjusting your search criteria or filters</p>
            </div>
          </div>
        )}
        </div>
      ) : (
        <div className="space-y-6">
          {filteredDoctors.length > 0 ? (
            <DoctorMap
              doctors={filteredDoctors}
              userLocation={userLocation || undefined}
              onDoctorClick={handleBookAppointment}
              className="mb-6"
            />
          ) : (
            <div className="text-center py-12">
              <UserGroupIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No doctors found</h3>
              <p className="text-gray-600">Try adjusting your search criteria or filters</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DoctorSearch; 