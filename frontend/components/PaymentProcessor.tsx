import React, { useState, useEffect, useRef } from 'react';
import {
  CreditCardIcon,
  BanknotesIcon,
  DevicePhoneMobileIcon,
  WalletIcon,
  BuildingLibraryIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ClockIcon,
  ShieldCheckIcon,
  LockClosedIcon
} from '@heroicons/react/24/outline';
import { apiClient } from '../lib/api';
import { newIdempotencyKey } from '../lib/idempotency';

interface PaymentProcessorProps {
  appointmentId: string;
  doctorId: string;
  amount: number;
  currency?: string;
  consultationType?: string; // cash/pay-at-clinic is only offered for in-person visits
  onPaymentSuccess: (paymentId: string) => void;
  onPaymentFailure: (error: string) => void;
  onCancel: () => void;
}

interface PaymentMethod {
  id: string;
  name: string;
  type: 'credit_card' | 'upi' | 'cash';
  gateway: 'stripe' | 'razorpay' | 'cash';
  icon: React.ComponentType<any>;
  description: string;
  processingTime: string;
  fees: number;
}

interface PaymentStatus {
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  message: string;
  transactionId?: string;
  timestamp: Date;
}

const PaymentProcessor: React.FC<PaymentProcessorProps> = ({
  appointmentId,
  doctorId,
  amount,
  currency = 'INR',
  consultationType,
  onPaymentSuccess,
  onPaymentFailure,
  onCancel
}) => {
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>({
    status: 'pending',
    message: 'Select a payment method to continue',
    timestamp: new Date()
  });
  const [isProcessing, setIsProcessing] = useState(false);
  // One key per logical payment; a retry replays the original charge instead
  // of creating a second one. Regenerated only after the payment completes.
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
  const [showCardForm, setShowCardForm] = useState(false);
  const [showUpiForm, setShowUpiForm] = useState(false);
  const [upiId, setUpiId] = useState('');
  const [cardDetails, setCardDetails] = useState({
    cardNumber: '',
    expiryDate: '',
    cvv: '',
    holderName: ''
  });

  const paymentMethods: PaymentMethod[] = [
    {
      id: 'stripe_card',
      name: 'Credit/Debit Card',
      type: 'credit_card',
      gateway: 'stripe',
      icon: CreditCardIcon,
      description: 'Visa, Mastercard, American Express',
      processingTime: 'Instant',
      fees: 2.9
    },
    {
      id: 'razorpay_upi',
      name: 'UPI Payment',
      type: 'upi',
      gateway: 'razorpay',
      icon: DevicePhoneMobileIcon,
      description: 'Google Pay, PhonePe, Paytm, BHIM',
      processingTime: 'Instant',
      fees: 0
    },
    // Cash is only meaningful for in-person visits (paid at the clinic).
    ...(consultationType === 'in-person' ? [{
      id: 'cash',
      name: 'Pay at Clinic',
      type: 'cash' as const,
      gateway: 'cash' as const,
      icon: BanknotesIcon,
      description: 'Pay by cash/card during your clinic visit',
      processingTime: 'During appointment',
      fees: 0
    }] : [])
  ];

  const calculateTotalAmount = () => {
    if (!selectedMethod) return amount;
    const fees = (amount * selectedMethod.fees) / 100;
    return amount + fees;
  };

  const formatAmount = (value: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency
    }).format(value);
  };

  const handleMethodSelect = (method: PaymentMethod) => {
    setSelectedMethod(method);
    setPaymentStatus({
      status: 'pending',
      message: `${method.name} selected. Click Pay Now to continue.`,
      timestamp: new Date()
    });
    setShowCardForm(method.type === 'credit_card');
    setShowUpiForm(method.type === 'upi');
  };

  const validateUpiId = () => {
    // Basic VPA shape: handle@bank
    if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upiId.trim())) {
      return 'Please enter a valid UPI ID (e.g. name@okhdfc)';
    }
    return null;
  };

  const validateCardDetails = () => {
    if (!cardDetails.cardNumber || cardDetails.cardNumber.length < 16) {
      return 'Please enter a valid card number';
    }
    if (!cardDetails.expiryDate || !cardDetails.expiryDate.match(/^\d{2}\/\d{2}$/)) {
      return 'Please enter expiry date in MM/YY format';
    }
    if (!cardDetails.cvv || cardDetails.cvv.length < 3) {
      return 'Please enter a valid CVV';
    }
    if (!cardDetails.holderName.trim()) {
      return 'Please enter card holder name';
    }
    return null;
  };

  const processPayment = async () => {
    if (!selectedMethod) {
      onPaymentFailure('Please select a payment method');
      return;
    }

    if (showCardForm) {
      const validationError = validateCardDetails();
      if (validationError) {
        setPaymentStatus({ status: 'failed', message: validationError, timestamp: new Date() });
        return;
      }
    }

    if (showUpiForm) {
      const validationError = validateUpiId();
      if (validationError) {
        setPaymentStatus({ status: 'failed', message: validationError, timestamp: new Date() });
        return;
      }
    }

    setIsProcessing(true);
    setPaymentStatus({
      status: 'processing',
      message: 'Processing your payment...',
      timestamp: new Date()
    });

    try {
      // Create payment using apiClient to route to backend. The Idempotency-Key
      // guarantees a retry (double-click, timeout) can never double-charge.
      const createResponse = await apiClient.post('/payments', {
        appointmentId,
        doctorId,
        amount: amount, // Send base amount (not calculateTotalAmount() which includes fees)
        currency,
        paymentMethod: selectedMethod.type,
        paymentGateway: selectedMethod.gateway,
        metadata: {
          fees: (amount * selectedMethod.fees) / 100,
          originalAmount: amount,
          totalAmountPaid: calculateTotalAmount(), // Track total amount in metadata
          paymentMethodName: selectedMethod.name
        }
      }, {
        headers: { 'Idempotency-Key': idempotencyKeyRef.current },
      });

      if (!createResponse.data.success) {
        throw new Error('Failed to create payment');
      }

      const paymentData = createResponse.data;
      const paymentId = paymentData.data._id;

      // Process payment based on gateway
      let paymentDetails: any = {};
      
      if (selectedMethod.gateway === 'stripe') {
        paymentDetails = {
          cardNumber: cardDetails.cardNumber,
          expiryDate: cardDetails.expiryDate,
          cvv: cardDetails.cvv,
          holderName: cardDetails.holderName
        };
      } else if (selectedMethod.gateway === 'razorpay') {
        paymentDetails = {
          method: selectedMethod.type,
          upiId: upiId.trim()
        };
      } else if (selectedMethod.gateway === 'cash') {
        paymentDetails = {
          note: 'Cash payment to be collected during appointment'
        };
      }

      // Process the payment
      const processResponse = await apiClient.post(`/payments/${paymentId}/process`, {
        paymentDetails: paymentDetails  // Wrap paymentDetails as expected by backend
      });

      if (processResponse.data.success) {
        const processData = processResponse.data;
        
        if (processData.data.status === 'completed') {
          idempotencyKeyRef.current = newIdempotencyKey();
          setPaymentStatus({
            status: 'completed',
            message: 'Payment completed successfully!',
            transactionId: processData.data.transactionId,
            timestamp: new Date()
          });
          
          setTimeout(() => {
            onPaymentSuccess(paymentId);
          }, 2000);
        } else {
          throw new Error(processData.data.failureReason || 'Payment failed');
        }
      } else {
        throw new Error('Payment processing failed');
      }

    } catch (error) {
      console.error('Payment error:', error);
      console.error('Error details:', {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText
      });
      
      let errorMessage = 'Payment failed';
      
      if (error.response?.status === 401 || error.response?.data?.error?.includes('token')) {
        errorMessage = 'Authentication failed. Please log in again to process payment.';
      } else if (error.response?.status === 400) {
        errorMessage = error.response?.data?.error || 'Invalid payment data. Please check your information.';
      } else if (error.response?.data?.error) {
        errorMessage = error.response.data.error;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      setPaymentStatus({
        status: 'failed',
        message: errorMessage,
        timestamp: new Date()
      });
      
      setTimeout(() => {
        onPaymentFailure(errorMessage);
      }, 3000);
    } finally {
      setIsProcessing(false);
    }
  };

  const getStatusIcon = () => {
    switch (paymentStatus.status) {
      case 'completed':
        return <CheckCircleIcon className="h-6 w-6 text-green-500" />;
      case 'failed':
        return <XCircleIcon className="h-6 w-6 text-red-500" />;
      case 'processing':
        return <ClockIcon className="h-6 w-6 text-blue-500 animate-spin" />;
      default:
        return <ExclamationTriangleIcon className="h-6 w-6 text-yellow-500" />;
    }
  };

  const getStatusColor = () => {
    switch (paymentStatus.status) {
      case 'completed':
        return 'border-green-500 bg-green-50';
      case 'failed':
        return 'border-red-500 bg-red-50';
      case 'processing':
        return 'border-blue-500 bg-blue-50';
      default:
        return 'border-yellow-500 bg-yellow-50';
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center mb-4">
          <LockClosedIcon className="h-8 w-8 text-green-500 mr-2" />
          <h2 className="text-2xl font-bold text-gray-900">Secure Payment</h2>
        </div>
        <div className="bg-gray-50 rounded-lg p-4">
          <div className="flex justify-between items-center text-lg">
            <span className="text-gray-600">Consultation Fee:</span>
            <span className="font-semibold">{formatAmount(amount)}</span>
          </div>
          {selectedMethod && selectedMethod.fees > 0 && (
            <div className="flex justify-between items-center text-sm text-gray-500 mt-1">
              <span>Processing Fee ({selectedMethod.fees}%):</span>
              <span>{formatAmount((amount * selectedMethod.fees) / 100)}</span>
            </div>
          )}
          <div className="border-t border-gray-300 mt-2 pt-2">
            <div className="flex justify-between items-center text-xl font-bold">
              <span>Total Amount:</span>
              <span className="text-blue-600">{formatAmount(calculateTotalAmount())}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Payment Status */}
      <div className={`border-2 rounded-lg p-4 mb-6 ${getStatusColor()}`}>
        <div className="flex items-center space-x-3">
          {getStatusIcon()}
          <div>
            <p className="font-medium">{paymentStatus.message}</p>
            {paymentStatus.transactionId && (
              <p className="text-sm text-gray-600">
                Transaction ID: {paymentStatus.transactionId}
              </p>
            )}
            <p className="text-xs text-gray-500">
              {paymentStatus.timestamp.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Payment Methods */}
      {paymentStatus.status !== 'completed' && (
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Select Payment Method</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {paymentMethods.map((method) => (
              <div
                key={method.id}
                onClick={() => handleMethodSelect(method)}
                className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
                  selectedMethod?.id === method.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-3 mb-2">
                  <method.icon className="h-6 w-6 text-gray-600" />
                  <span className="font-medium">{method.name}</span>
                </div>
                <p className="text-sm text-gray-600 mb-1">{method.description}</p>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>{method.processingTime}</span>
                  <span>{method.fees > 0 ? `${method.fees}% fee` : 'No fees'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* UPI Form */}
      {showUpiForm && paymentStatus.status !== 'completed' && (
        <div className="mb-6 p-4 border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-gray-900 flex items-center">
              <DevicePhoneMobileIcon className="h-5 w-5 text-green-500 mr-2" />
              UPI Payment
            </h4>
            <button
              onClick={() => setUpiId('demo@okhdfc')}
              className="text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded-full transition-colors"
            >
              Use Test UPI
            </button>
          </div>
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center space-x-2">
              <ExclamationTriangleIcon className="h-4 w-4 text-yellow-600" />
              <span className="text-sm text-yellow-800">
                <strong>Demo Mode:</strong> Enter any valid-looking UPI ID (e.g. <code>demo@okhdfc</code>). No real payment is collected.
              </span>
            </div>
          </div>
          <label className="block text-sm font-medium text-gray-700 mb-1">UPI ID</label>
          <input
            type="text"
            placeholder="yourname@bank"
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
            className="input-field"
          />
        </div>
      )}

      {/* Card Details Form */}
      {showCardForm && paymentStatus.status !== 'completed' && (
        <div className="mb-6 p-4 border border-gray-200 rounded-lg">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-gray-900 flex items-center">
              <ShieldCheckIcon className="h-5 w-5 text-green-500 mr-2" />
              Card Details
            </h4>
            <button
              onClick={() => setCardDetails({
                cardNumber: '4242 4242 4242 4242',
                expiryDate: '12/25',
                cvv: '123',
                holderName: 'Test User'
              })}
              className="text-sm bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1 rounded-full transition-colors"
            >
              Use Test Card
            </button>
          </div>
          
          {/* Test Card Notice */}
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <div className="flex items-center space-x-2">
              <ExclamationTriangleIcon className="h-4 w-4 text-yellow-600" />
              <span className="text-sm text-yellow-800">
                <strong>Demo Mode:</strong> Use the test card (4242 4242 4242 4242) for successful payments. No real charges will be made.
              </span>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Card Number
              </label>
              <input
                type="text"
                placeholder="1234 5678 9012 3456"
                value={cardDetails.cardNumber}
                onChange={(e) => setCardDetails(prev => ({ ...prev, cardNumber: e.target.value }))}
                className="input-field"
                maxLength={19}
              />
              <p className="text-xs text-gray-500 mt-1">
                Test cards: 4242 4242 4242 4242 (Success), 4000 0000 0000 0002 (Declined)
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Expiry Date
              </label>
              <input
                type="text"
                placeholder="MM/YY"
                value={cardDetails.expiryDate}
                onChange={(e) => setCardDetails(prev => ({ ...prev, expiryDate: e.target.value }))}
                className="input-field"
                maxLength={5}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                CVV
              </label>
              <input
                type="text"
                placeholder="123"
                value={cardDetails.cvv}
                onChange={(e) => setCardDetails(prev => ({ ...prev, cvv: e.target.value }))}
                className="input-field"
                maxLength={4}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Card Holder Name
              </label>
              <input
                type="text"
                placeholder="John Doe"
                value={cardDetails.holderName}
                onChange={(e) => setCardDetails(prev => ({ ...prev, holderName: e.target.value }))}
                className="input-field"
              />
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      {paymentStatus.status !== 'completed' && (
        <div className="flex space-x-4">
          <button
            onClick={onCancel}
            className="btn-secondary flex-1"
            disabled={isProcessing}
          >
            Cancel
          </button>
          <button
            onClick={processPayment}
            disabled={!selectedMethod || isProcessing}
            className="btn-primary flex-1"
          >
            {isProcessing ? (
              <div className="flex items-center justify-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>Processing...</span>
              </div>
            ) : (
              `Pay ${formatAmount(calculateTotalAmount())}`
            )}
          </button>
        </div>
      )}

      {/* Security Notice */}
      <div className="mt-6 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center space-x-2 text-sm text-gray-600">
          <ShieldCheckIcon className="h-4 w-4 text-green-500" />
          <span>Your payment information is encrypted and secure</span>
        </div>
      </div>
    </div>
  );
};

export default PaymentProcessor; 