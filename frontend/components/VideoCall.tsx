import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  PhoneXMarkIcon,
  ComputerDesktopIcon,
  ChatBubbleLeftRightIcon,
  SpeakerXMarkIcon,
  CameraIcon,
  XMarkIcon,
  ClockIcon,
  SignalIcon
} from '@heroicons/react/24/outline';
import {
  VideoCameraIcon as VideoCameraIconSolid,
  MicrophoneIcon as MicrophoneIconSolid
} from '@heroicons/react/24/solid';
import { apiClient } from '../lib/api';
import { getSocket } from '../lib/socket';

/**
 * Real WebRTC video call.
 *
 * Architecture: the backend's Socket.IO room (`call:{callId}`) is the SIGNALING channel —
 * it only relays SDP offers/answers and ICE candidates. Media flows peer-to-peer between
 * the two browsers (STUN for NAT traversal); no video frame ever touches our server.
 *
 * Offer convention: the peer already in the room initiates the offer when it sees
 * `call:peer-joined` (deterministic initiator — avoids offer glare in a 1:1 call).
 */

interface VideoCallProps {
  callId: string;            // room key (appointment id)
  userRole: 'host' | 'guest';
  onCallEnd: () => void;
  onError: (error: string) => void;
}

interface ChatMessage {
  id: string;
  sender: 'me' | 'peer';
  message: string;
  timestamp: Date;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const VideoCall: React.FC<VideoCallProps> = ({ callId, userRole, onCallEnd, onError }) => {
  const [status, setStatus] = useState<'initializing' | 'waiting' | 'connecting' | 'connected' | 'peer-left'>('initializing');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [duration, setDuration] = useState(0);
  const [showChat, setShowChat] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const durationRef = useRef<ReturnType<typeof setInterval>>();

  // ---------- peer connection ----------
  const createPeerConnection = useCallback((): RTCPeerConnection => {
    if (pcRef.current) return pcRef.current;
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current!));

    pc.onicecandidate = (e) => {
      if (e.candidate) getSocket()?.emit('webrtc:ice', { callId, candidate: e.candidate });
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current && e.streams[0]) {
        remoteVideoRef.current.srcObject = e.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setStatus('connected');
        if (!durationRef.current) {
          durationRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
        }
      } else if (pc.connectionState === 'failed') {
        onError('Connection lost. Please rejoin the call.');
      }
    };

    return pc;
  }, [callId, onError]);

  const flushPendingIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;
    for (const candidate of pendingIceRef.current) {
      await pc.addIceCandidate(candidate).catch(() => {});
    }
    pendingIceRef.current = [];
  }, []);

  // ---------- lifecycle ----------
  useEffect(() => {
    let cancelled = false;
    const socket = getSocket();
    if (!socket) return;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        cameraTrackRef.current = stream.getVideoTracks()[0] || null;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        setStatus('waiting');
        socket.emit('call:join', { callId });
      } catch {
        onError('Could not access camera/microphone. Please allow permissions and retry.');
      }
    };

    // Existing peer sees the newcomer -> initiates the offer
    const onPeerJoined = async () => {
      setStatus('connecting');
      const pc = createPeerConnection();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc:offer', { callId, sdp: offer });
    };

    const onOffer = async ({ sdp }: { sdp: RTCSessionDescriptionInit }) => {
      setStatus('connecting');
      const pc = createPeerConnection();
      await pc.setRemoteDescription(sdp);
      await flushPendingIce();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc:answer', { callId, sdp: answer });
    };

    const onAnswer = async ({ sdp }: { sdp: RTCSessionDescriptionInit }) => {
      await pcRef.current?.setRemoteDescription(sdp);
      await flushPendingIce();
    };

    const onIce = async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      if (pcRef.current?.remoteDescription) {
        await pcRef.current.addIceCandidate(candidate).catch(() => {});
      } else {
        pendingIceRef.current.push(candidate); // arrived before the SDP — queue it
      }
    };

    const onPeerLeft = () => {
      setStatus('peer-left');
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      pcRef.current?.close();
      pcRef.current = null;
    };

    const onChat = ({ message, timestamp }: { message: string; timestamp: string }) => {
      setMessages((prev) => [...prev, {
        id: `${Date.now()}-peer`, sender: 'peer', message, timestamp: new Date(timestamp)
      }]);
      setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }), 50);
    };

    socket.on('call:peer-joined', onPeerJoined);
    socket.on('webrtc:offer', onOffer);
    socket.on('webrtc:answer', onAnswer);
    socket.on('webrtc:ice', onIce);
    socket.on('call:peer-left', onPeerLeft);
    socket.on('chat:message', onChat);

    start();

    return () => {
      cancelled = true;
      socket.emit('call:leave', { callId });
      socket.off('call:peer-joined', onPeerJoined);
      socket.off('webrtc:offer', onOffer);
      socket.off('webrtc:answer', onAnswer);
      socket.off('webrtc:ice', onIce);
      socket.off('call:peer-left', onPeerLeft);
      socket.off('chat:message', onChat);
      pcRef.current?.close();
      pcRef.current = null;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      if (durationRef.current) clearInterval(durationRef.current);
    };
  }, [callId, createPeerConnection, flushPendingIce, onError]);

  // ---------- controls ----------
  const toggleMute = () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    }
  };

  const toggleCamera = () => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsCameraOff(!track.enabled);
    }
  };

  const toggleScreenShare = async () => {
    const pc = pcRef.current;
    const sender = pc?.getSenders().find((s) => s.track?.kind === 'video');
    try {
      if (!isScreenSharing) {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const screenTrack = display.getVideoTracks()[0];
        if (sender && screenTrack) {
          await sender.replaceTrack(screenTrack); // no renegotiation needed
          setIsScreenSharing(true);
          screenTrack.onended = async () => {
            if (cameraTrackRef.current) await sender.replaceTrack(cameraTrackRef.current);
            setIsScreenSharing(false);
          };
        }
      } else if (sender && cameraTrackRef.current) {
        await sender.replaceTrack(cameraTrackRef.current);
        setIsScreenSharing(false);
      }
    } catch {
      /* user cancelled the share picker */
    }
  };

  const endCall = async () => {
    if (userRole === 'host') {
      // Doctor formally ends the consultation (marks appointment completed)
      await apiClient.post('/video-calls/end-active', {}).catch(() => {});
    }
    onCallEnd();
  };

  const sendMessage = () => {
    const text = newMessage.trim();
    if (!text) return;
    getSocket()?.emit('chat:message', { callId, message: text });
    setMessages((prev) => [...prev, { id: `${Date.now()}-me`, sender: 'me', message: text, timestamp: new Date() }]);
    setNewMessage('');
    setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }), 50);
  };

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const statusLabel: Record<typeof status, string> = {
    initializing: 'Starting camera…',
    waiting: 'Waiting for the other participant…',
    connecting: 'Connecting…',
    connected: 'Connected',
    'peer-left': 'The other participant left',
  };

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 p-4 flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <h3 className="text-white font-semibold">Video Consultation</h3>
          <div className="flex items-center space-x-2 text-gray-300">
            <ClockIcon className="h-4 w-4" />
            <span className="text-sm">{formatDuration(duration)}</span>
          </div>
          <div className={`flex items-center space-x-1 text-sm ${status === 'connected' ? 'text-green-400' : 'text-yellow-400'}`}>
            <SignalIcon className="h-4 w-4" />
            <span>{statusLabel[status]}</span>
          </div>
        </div>
        <button onClick={() => setShowChat(!showChat)} className="text-white hover:text-blue-400 transition-colors">
          <ChatBubbleLeftRightIcon className="h-6 w-6" />
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        <div className={`${showChat ? 'w-3/4' : 'w-full'} relative bg-gray-900`}>
          {/* Remote video (the other person) */}
          <video ref={remoteVideoRef} className="w-full h-full object-cover" autoPlay playsInline />
          {status !== 'connected' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-gray-300">
                <div className="animate-pulse mb-3">
                  <VideoCameraIconSolid className="h-12 w-12 mx-auto opacity-50" />
                </div>
                <p>{statusLabel[status]}</p>
              </div>
            </div>
          )}

          {/* Local preview */}
          <div className="absolute top-4 right-4 w-48 h-36 bg-gray-800 rounded-lg overflow-hidden shadow-lg">
            <video ref={localVideoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
            {isCameraOff && (
              <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
                <CameraIcon className="h-8 w-8 text-gray-400" />
              </div>
            )}
          </div>

          {isScreenSharing && (
            <div className="absolute top-4 left-4 bg-blue-600 text-white px-3 py-1 rounded-full text-sm">
              Screen Sharing
            </div>
          )}
        </div>

        {/* Chat panel (relayed over the same socket room) */}
        {showChat && (
          <div className="w-1/4 bg-white border-l border-gray-300 flex flex-col">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h4 className="font-semibold text-gray-900">Chat</h4>
              <button onClick={() => setShowChat(false)} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>
            <div ref={chatRef} className="flex-1 p-4 overflow-y-auto">
              {messages.map((m) => (
                <div key={m.id} className={`mb-3 ${m.sender === 'me' ? 'text-right' : ''}`}>
                  <div className="text-xs text-gray-500 mb-1">
                    {m.sender === 'me' ? 'You' : 'Participant'} · {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className={`inline-block rounded-lg p-2 text-sm max-w-[90%] ${m.sender === 'me' ? 'bg-blue-500 text-white' : 'bg-gray-100'}`}>
                    {m.message}
                  </div>
                </div>
              ))}
            </div>
            <div className="p-4 border-t border-gray-200">
              <div className="flex space-x-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Type a message…"
                  className="flex-1 input-field"
                />
                <button onClick={sendMessage} className="btn-primary px-4">Send</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-gray-900 p-4">
        <div className="flex justify-center space-x-4">
          <button
            onClick={toggleMute}
            className={`p-3 rounded-full transition-colors ${isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'}`}
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <SpeakerXMarkIcon className="h-6 w-6 text-white" /> : <MicrophoneIconSolid className="h-6 w-6 text-white" />}
          </button>

          <button
            onClick={toggleCamera}
            className={`p-3 rounded-full transition-colors ${isCameraOff ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-700 hover:bg-gray-600'}`}
            title={isCameraOff ? 'Turn camera on' : 'Turn camera off'}
          >
            <VideoCameraIconSolid className="h-6 w-6 text-white" />
          </button>

          <button
            onClick={toggleScreenShare}
            className={`p-3 rounded-full transition-colors ${isScreenSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 hover:bg-gray-600'}`}
            title="Share screen"
          >
            <ComputerDesktopIcon className="h-6 w-6 text-white" />
          </button>

          <button onClick={endCall} className="p-3 rounded-full bg-red-600 hover:bg-red-700 transition-colors" title="End call">
            <PhoneXMarkIcon className="h-6 w-6 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;
