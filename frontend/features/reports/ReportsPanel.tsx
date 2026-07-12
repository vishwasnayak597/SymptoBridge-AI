import React, { useState } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowDownTrayIcon,
  BeakerIcon,
  DocumentArrowUpIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import { useReports } from './useReports';
import { getErrorMessage } from '../../lib/errors';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'application/pdf'];

const EMPTY_FORM = { title: '', type: 'blood_test', description: '', reportDate: '' };

/**
 * Medical reports: upload (validated client-side), list, download, delete.
 * Fully self-contained — owns its form state and its server state (useReports),
 * so the dashboard page only renders <ReportsPanel />.
 */
export default function ReportsPanel() {
  const { reports, isLoading, uploadReport, removeReport, downloadReport } = useReports();
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadForm, setUploadForm] = useState(EMPTY_FORM);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      toast.error('File size must be less than 10MB');
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast.error('Invalid file type. Only images and PDFs are allowed.');
      return;
    }
    setSelectedFile(file);
    setUploadForm((prev) => ({ ...prev, title: prev.title || file.name.split('.')[0] }));
  };

  const resetForm = () => {
    setSelectedFile(null);
    setUploadForm(EMPTY_FORM);
    setShowUploadForm(false);
  };

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) {
      toast.error('Please select a file');
      return;
    }
    if (!uploadForm.title.trim()) {
      toast.error('Please enter a title');
      return;
    }
    try {
      setUploading(true);
      await uploadReport(selectedFile, uploadForm);
      resetForm();
      toast.success('Report uploaded successfully!');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to upload report. Please try again.'));
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (reportId: string, fileName: string) => {
    try {
      await downloadReport(reportId, fileName);
    } catch (error) {
      toast.error('Failed to download report. Please try again.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Medical Reports</h2>
          <p className="text-gray-600">Upload and manage your medical reports and test results</p>
        </div>
        <button
          onClick={() => setShowUploadForm(!showUploadForm)}
          className="btn-primary flex items-center"
          disabled={uploading}
        >
          <DocumentArrowUpIcon className="h-4 w-4 mr-2" />
          {uploading ? 'Uploading...' : 'Upload Report'}
        </button>
      </div>

      {/* Upload Form */}
      {showUploadForm && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 border border-blue-200">
          <form onSubmit={handleUploadSubmit} className="space-y-4">
            <div>
              <label htmlFor="report-file" className="block text-sm font-medium text-gray-700 mb-2">
                Select File *
              </label>
              <input
                id="report-file"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.gif"
                onChange={handleFileSelect}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                required
              />
              {selectedFile && (
                <p className="text-sm text-green-600 mt-1">
                  Selected: {selectedFile.name} ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="report-title" className="block text-sm font-medium text-gray-700 mb-2">
                  Report Title *
                </label>
                <input
                  id="report-title"
                  type="text"
                  value={uploadForm.title}
                  onChange={(e) => setUploadForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="input-field"
                  placeholder="e.g., Blood Test Report"
                  required
                />
              </div>

              <div>
                <label htmlFor="report-type" className="block text-sm font-medium text-gray-700 mb-2">
                  Report Type *
                </label>
                <select
                  id="report-type"
                  value={uploadForm.type}
                  onChange={(e) => setUploadForm((prev) => ({ ...prev, type: e.target.value }))}
                  className="input-field"
                  required
                >
                  <option value="blood_test">Blood Test</option>
                  <option value="xray">X-Ray</option>
                  <option value="mri">MRI Scan</option>
                  <option value="ct_scan">CT Scan</option>
                  <option value="ultrasound">Ultrasound</option>
                  <option value="lab_report">Lab Report</option>
                  <option value="prescription">Prescription</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="report-date" className="block text-sm font-medium text-gray-700 mb-2">
                Report Date
              </label>
              <input
                id="report-date"
                type="date"
                value={uploadForm.reportDate}
                onChange={(e) => setUploadForm((prev) => ({ ...prev, reportDate: e.target.value }))}
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="report-description" className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                id="report-description"
                value={uploadForm.description}
                onChange={(e) => setUploadForm((prev) => ({ ...prev, description: e.target.value }))}
                className="input-field"
                rows={3}
                placeholder="Optional notes about this report"
              />
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploading || !selectedFile}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? 'Uploading...' : 'Upload Report'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Uploaded Reports */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Uploaded Reports ({reports.length})
        </h3>

        {isLoading ? (
          <div className="text-center py-8" role="status" aria-label="Loading reports">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
            <p className="text-gray-600 mt-2">Loading reports...</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-8">
            <PhotoIcon className="h-12 w-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">No reports uploaded yet</p>
            <button
              onClick={() => setShowUploadForm(true)}
              className="text-blue-600 hover:text-blue-800 text-sm mt-2"
            >
              Upload your first report
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reports.map((report) => (
              <div key={report.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between mb-3">
                  <div className={`p-2 rounded-lg ${
                    report.type === 'blood_test' ? 'bg-red-100 text-red-600' :
                    report.type === 'xray' ? 'bg-blue-100 text-blue-600' :
                    report.type === 'mri' ? 'bg-purple-100 text-purple-600' :
                    report.type === 'ct_scan' ? 'bg-green-100 text-green-600' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {report.type === 'blood_test' ? <BeakerIcon className="h-5 w-5" /> :
                     report.type === 'xray' ? <PhotoIcon className="h-5 w-5" /> :
                     <DocumentTextIcon className="h-5 w-5" />}
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleDownload(report.id, report.fileName)}
                      className="p-1 text-gray-400 hover:text-green-600 transition-colors"
                      title="Download"
                      aria-label={`Download ${report.title || report.fileName}`}
                    >
                      <ArrowDownTrayIcon className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => removeReport(report.id)}
                      className="p-1 text-red-400 hover:text-red-600 transition-colors"
                      title="Delete"
                      aria-label={`Delete ${report.title || report.fileName}`}
                    >
                      <ExclamationTriangleIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <h4 className="font-medium text-gray-900 text-sm mb-1">
                  {report.title || report.fileName}
                </h4>
                <p className="text-xs text-gray-600 mb-2">
                  {new Date(report.uploadDate).toLocaleDateString()}
                </p>
                <p className="text-xs text-gray-500">
                  {((report.fileSize || 0) / (1024 * 1024)).toFixed(2)} MB
                </p>

                <span className={`inline-block px-2 py-1 text-xs font-medium rounded-full mt-2 ${
                  (report.type || 'general') === 'blood_test' ? 'bg-red-100 text-red-800' :
                  (report.type || 'general') === 'xray' ? 'bg-blue-100 text-blue-800' :
                  (report.type || 'general') === 'mri' ? 'bg-purple-100 text-purple-800' :
                  (report.type || 'general') === 'ct_scan' ? 'bg-green-100 text-green-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {(report.type || 'general').replace('_', ' ').toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
