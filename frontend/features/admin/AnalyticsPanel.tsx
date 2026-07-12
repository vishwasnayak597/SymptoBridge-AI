import React from 'react';
import { UsersIcon, CalendarDaysIcon, BanknotesIcon, CheckBadgeIcon, ClockIcon } from '@heroicons/react/24/outline';

export interface PlatformStats {
  totalUsers: number;
  totalDoctors: number;
  totalPatients: number;
  totalAppointments: number;
  totalRevenue: number;
  activeUsers: number;
  pendingVerifications: number;
  systemHealth?: string;
}

const inr = (n: number) => `₹${(n || 0).toLocaleString('en-IN')}`;

function Bar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-700">{label}</span>
        <span className="font-medium text-gray-900">{value.toLocaleString('en-IN')} ({pct}%)</span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-gray-100" role="img" aria-label={`${label}: ${pct} percent`}>
        <div className={`h-2.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-600">{label}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`p-2 rounded-lg ${tone}`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

/**
 * Platform analytics derived from the admin stats already loaded for the
 * overview — no extra fetch. Composition bars + headline metrics.
 */
export default function AnalyticsPanel({ stats }: { stats: PlatformStats }) {
  const admins = Math.max(0, stats.totalUsers - stats.totalDoctors - stats.totalPatients);
  const avgRevenuePerAppt = stats.totalAppointments > 0 ? stats.totalRevenue / stats.totalAppointments : 0;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Analytics</h2>
        <p className="text-gray-600">Platform composition and headline metrics</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric icon={CalendarDaysIcon} label="Appointments" value={stats.totalAppointments.toLocaleString('en-IN')} tone="bg-blue-100 text-blue-600" />
        <Metric icon={BanknotesIcon} label="Total Revenue" value={inr(stats.totalRevenue)} tone="bg-green-100 text-green-600" />
        <Metric icon={UsersIcon} label="Active Users" value={stats.activeUsers.toLocaleString('en-IN')} tone="bg-purple-100 text-purple-600" />
        <Metric icon={CheckBadgeIcon} label="Avg / Appointment" value={inr(Math.round(avgRevenuePerAppt))} tone="bg-orange-100 text-orange-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Users by role</h3>
          <div className="space-y-4">
            <Bar label="Patients" value={stats.totalPatients} total={stats.totalUsers} color="bg-blue-500" />
            <Bar label="Doctors" value={stats.totalDoctors} total={stats.totalUsers} color="bg-green-500" />
            <Bar label="Admins" value={admins} total={stats.totalUsers} color="bg-purple-500" />
          </div>
          <p className="text-sm text-gray-500 mt-4">{stats.totalUsers.toLocaleString('en-IN')} users total</p>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Operational</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
              <div className="flex items-center space-x-2">
                <ClockIcon className="h-5 w-5 text-yellow-600" />
                <span className="text-sm text-gray-700">Doctors pending verification</span>
              </div>
              <span className="text-lg font-bold text-gray-900">{stats.pendingVerifications}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-700">Registered doctors</span>
              <span className="text-lg font-bold text-gray-900">{stats.totalDoctors.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-700">Registered patients</span>
              <span className="text-lg font-bold text-gray-900">{stats.totalPatients.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
