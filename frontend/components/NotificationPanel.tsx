import React, { useState, useEffect, useRef } from 'react';
import {
  BellIcon,
  CheckIcon,
  XMarkIcon,
  EllipsisVerticalIcon,
  CalendarDaysIcon,
  CreditCardIcon,
  DocumentTextIcon,
  CheckCircleIcon,
  VideoCameraIcon,
  WrenchScrewdriverIcon,
  InformationCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon
} from '@heroicons/react/24/outline';
import { BellIcon as BellIconSolid } from '@heroicons/react/24/solid';
import { apiClient } from '../lib/api';

interface Notification {
  _id: string;
  type: 'appointment_scheduled' | 'appointment_confirmed' | 'appointment_cancelled' | 'appointment_reminder' |
        'payment_received' | 'payment_failed' | 'prescription_ready' | 'doctor_verified' | 'account_activated' |
        'video_call_starting' | 'system_maintenance' | 'general';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  title: string;
  message: string;
  isRead: boolean;
  actionUrl?: string;
  actionText?: string;
  createdAt: string;
  data?: Record<string, any>;
  timeSinceCreated: string;
}

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onNotificationClick?: (notification: Notification) => void;
  /** Notifies the parent (e.g. the header bell badge) whenever the authoritative
   *  unread count changes, so the badge stays in sync as notifications are read. */
  onUnreadCountChange?: (count: number) => void;
}

const NotificationPanel: React.FC<NotificationPanelProps> = ({
  isOpen,
  onClose,
  onNotificationClick,
  onUnreadCountChange
}) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<'all' | 'unread' | 'appointments' | 'payments' | 'system'>('all');
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications();
      fetchUnreadCount();
      const interval = setInterval(() => {
        fetchNotifications();
        fetchUnreadCount();
      }, 30000); // Refresh every 30 seconds
      
      return () => clearInterval(interval);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);

  const fetchNotifications = async () => {
    try {
      const response = await apiClient.get('/notifications');

      if (response.data.success) {
        setNotifications(response.data.data?.notifications || []);
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const response = await apiClient.get('/notifications/unread-count');

      if (response.data.success) {
        const count = response.data.data?.count || 0;
        setUnreadCount(count);
        onUnreadCountChange?.(count);
      }
    } catch (error) {
      console.error('Error fetching unread count:', error);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await apiClient.patch(`/notifications/${notificationId}/read`, {});

      setNotifications(prev =>
        prev.map(notification =>
          notification._id === notificationId
            ? { ...notification, isRead: true }
            : notification
        )
      );

      // Re-sync the true unread count from the server so the header badge updates too
      fetchUnreadCount();
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      await apiClient.patch('/notifications/mark-all-read', {});

      setNotifications(prev =>
        prev.map(notification => ({ ...notification, isRead: true }))
      );

      setUnreadCount(0);
      onUnreadCountChange?.(0);
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const deleteNotification = async (notificationId: string) => {
    try {
      await apiClient.delete(`/notifications/${notificationId}`);

      setNotifications(prev =>
        prev.filter(notification => notification._id !== notificationId)
      );
    } catch (error) {
      console.error('Error deleting notification:', error);
    }
  };

  const getNotificationIcon = (type: Notification['type']) => {
    const iconClass = "h-5 w-5";
    
    switch (type) {
      case 'appointment_scheduled':
      case 'appointment_confirmed':
      case 'appointment_cancelled':
      case 'appointment_reminder':
        return <CalendarDaysIcon className={`${iconClass} text-blue-500`} />;
      case 'payment_received':
      case 'payment_failed':
        return <CreditCardIcon className={`${iconClass} text-green-500`} />;
      case 'prescription_ready':
        return <DocumentTextIcon className={`${iconClass} text-purple-500`} />;
      case 'doctor_verified':
      case 'account_activated':
        return <CheckCircleIcon className={`${iconClass} text-green-500`} />;
      case 'video_call_starting':
        return <VideoCameraIcon className={`${iconClass} text-indigo-500`} />;
      case 'system_maintenance':
        return <WrenchScrewdriverIcon className={`${iconClass} text-orange-500`} />;
      default:
        return <InformationCircleIcon className={`${iconClass} text-gray-500`} />;
    }
  };

  const getPriorityColor = (priority: Notification['priority']) => {
    switch (priority) {
      case 'urgent':
        return 'border-l-red-500 bg-red-50';
      case 'high':
        return 'border-l-orange-500 bg-orange-50';
      case 'medium':
        return 'border-l-blue-500 bg-blue-50';
      default:
        return 'border-l-gray-300 bg-gray-50';
    }
  };

  const getPriorityIcon = (priority: Notification['priority']) => {
    switch (priority) {
      case 'urgent':
        return <ExclamationTriangleIcon className="h-4 w-4 text-red-500" />;
      case 'high':
        return <ExclamationTriangleIcon className="h-4 w-4 text-orange-500" />;
      case 'medium':
        return <InformationCircleIcon className="h-4 w-4 text-blue-500" />;
      default:
        return <CheckCircleIcon className="h-4 w-4 text-gray-500" />;
    }
  };

  const getFilteredNotifications = () => {
    return notifications.filter(notification => {
      if (filter === 'unread') return !notification.isRead;
      if (filter === 'appointments') return notification.type.includes('appointment');
      if (filter === 'payments') return notification.type.includes('payment');
      if (filter === 'system') return ['system_maintenance', 'general'].includes(notification.type);
      return true;
    });
  };

  const handleNotificationClick = (notification: Notification) => {
    if (!notification.isRead) {
      markAsRead(notification._id);
    }
    
    if (onNotificationClick) {
      onNotificationClick(notification);
    }
    
    if (notification.actionUrl) {
      // Handle navigation based on actionUrl
      window.location.href = notification.actionUrl;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black bg-opacity-25" onClick={onClose} />
      
      <div
        ref={panelRef}
        className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl transform transition-transform duration-300 ease-in-out"
      >
        {/* Header */}
        <div className="bg-gray-50 border-b border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <BellIconSolid className="h-6 w-6 text-blue-500" />
              <h2 className="text-lg font-semibold text-gray-900">Notifications</h2>
              {unreadCount > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1 min-w-[20px] text-center">
                  {unreadCount}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {/* Filters */}
          <div className="mt-4 flex space-x-2 overflow-x-auto">
            {['all', 'unread', 'appointments', 'payments', 'system'].map((filterOption) => (
              <button
                key={filterOption}
                onClick={() => setFilter(filterOption as typeof filter)}
                className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  filter === filterOption
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {filterOption.charAt(0).toUpperCase() + filterOption.slice(1)}
              </button>
            ))}
          </div>

          {/* Actions */}
          {unreadCount > 0 && (
            <div className="mt-3">
              <button
                onClick={markAllAsRead}
                className="text-sm text-blue-600 hover:text-blue-800 font-medium"
              >
                Mark all as read
              </button>
            </div>
          )}
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            </div>
          ) : getFilteredNotifications().length === 0 ? (
            <div className="text-center py-12">
              <BellIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No notifications</h3>
              <p className="text-gray-500">
                {filter === 'all' ? 'You\'re all caught up!' : `No ${filter} notifications found`}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {getFilteredNotifications().map((notification) => (
                <div
                  key={notification._id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors border-l-4 ${
                    getPriorityColor(notification.priority)
                  } ${notification.isRead ? 'opacity-75' : ''}`}
                >
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 mt-1">
                      {getNotificationIcon(notification.type)}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2">
                            <p className={`text-sm font-medium ${
                              notification.isRead ? 'text-gray-600' : 'text-gray-900'
                            }`}>
                              {notification.title}
                            </p>
                            {getPriorityIcon(notification.priority)}
                          </div>
                          <p className={`mt-1 text-sm ${
                            notification.isRead ? 'text-gray-500' : 'text-gray-700'
                          }`}>
                            {notification.message}
                          </p>
                          
                          {notification.actionText && notification.actionUrl && (
                            <div className="mt-2">
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                                {notification.actionText}
                              </span>
                            </div>
                          )}
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          {!notification.isRead && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                markAsRead(notification._id);
                              }}
                              className="text-blue-600 hover:text-blue-800"
                              title="Mark as read"
                            >
                              <CheckIcon className="h-4 w-4" />
                            </button>
                          )}
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteNotification(notification._id);
                            }}
                            className="text-gray-400 hover:text-red-600"
                            title="Delete notification"
                          >
                            <XMarkIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="mt-2 flex items-center space-x-2 text-xs text-gray-500">
                        <ClockIcon className="h-3 w-3" />
                        <span>{notification.timeSinceCreated}</span>
                        {!notification.isRead && (
                          <span className="inline-block w-2 h-2 bg-blue-500 rounded-full"></span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotificationPanel; 