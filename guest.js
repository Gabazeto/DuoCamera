/**
 * guest.js - Lógica do Convidado WebRTC via PeerJS
 * Roda no navegador do amigo (mobile ou desktop) sem precisar de extensão.
 */

// Elementos da UI
const lobbyScreen = document.getElementById('lobbyScreen');
const callScreen = document.getElementById('callScreen');
const lobbyVideo = document.getElementById('lobbyVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localVideo = document.getElementById('localVideo');
const roomInput = document.getElementById('roomInput');
const nameInput = document.getElementById('nameInput');
const btnJoinRoom = document.getElementById('btnJoinRoom');
const btnToggleMic = document.getElementById('btnToggleMic');
const btnToggleCam = document.getElementById('btnToggleCam');
const btnFlipCam = document.getElementById('btnFlipCam');
const btnLeaveRoom = document.getElementById('btnLeaveRoom');
const connectionStatus = document.getElementById('connectionStatus');
const statusText = document.getElementById('statusText');
const localNameBadge = document.getElementById('localNameBadge');

// Estado
let localStream = null;
let peer = null;
let currentCall = null;
let currentFacingMode = 'user'; // 'user' ou 'environment'
let isMicMuted = false;
let isCamOff = false;

// 1. Extrai ID da sala dos parâmetros da URL (?room=duo-xyz)
function initUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const room = params.get('room') || params.get('id');
  if (room) {
    roomInput.value = room;
    roomInput.readOnly = true;
  }

  // Tenta restaurar nome salvo anteriormente
  const savedName = localStorage.getItem('multicam_guest_name');
  if (savedName) {
    nameInput.value = savedName;
  }
}

// 2. Atualiza badge de status
function setStatus(status, text) {
  connectionStatus.className = 'status-pill status-' + status;
  statusText.textContent = text;
}

// 3. Inicializa câmera para o lobby
async function startCamera(facingMode = 'user') {
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facingMode,
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    localStream = stream;
    lobbyVideo.srcObject = stream;
    localVideo.srcObject = stream;
    currentFacingMode = facingMode;

    // Aplica estados anteriores se já foram alternados
    localStream.getAudioTracks().forEach(t => (t.enabled = !isMicMuted));
    localStream.getVideoTracks().forEach(t => (t.enabled = !isCamOff));

    return stream;
  } catch (err) {
    console.error('Falha ao acessar câmera/microfone:', err);
    alert('Permissão de câmera e microfone necessária para participar!');
    throw err;
  }
}

// 4. Conectar ao Host via WebRTC (PeerJS)
async function joinRoom() {
  const roomId = roomInput.value.trim();
  const guestName = nameInput.value.trim() || 'Convidado';

  if (!roomId) {
    alert('Por favor, informe o ID da sala!');
    return;
  }

  localStorage.setItem('multicam_guest_name', guestName);
  localNameBadge.textContent = guestName;

  btnJoinRoom.disabled = true;
  setStatus('connecting', 'Conectando...');

  try {
    if (!localStream) {
      await startCamera(currentFacingMode);
    }

    // Cria um ID único aleatório para o convidado
    const guestPeerId = 'guest-' + Math.random().toString(36).substring(2, 9);
    peer = new Peer(guestPeerId, {
      debug: 1,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      }
    });

    peer.on('open', (id) => {
      console.log('Convidado conectado com Peer ID:', id);

      // 1. Abre canal de dados para enviar nome ao Host
      const conn = peer.connect(roomId);
      conn.on('open', () => {
        conn.send({ type: 'GUEST_JOIN', name: guestName });
      });

      // 2. Dispara a chamada de vídeo/áudio para o Host
      const call = peer.call(roomId, localStream);
      currentCall = call;

      call.on('stream', (hostRemoteStream) => {
        console.log('Recebido stream de retorno do Host:', hostRemoteStream);
        remoteVideo.srcObject = hostRemoteStream;
        setStatus('connected', 'Conectado');
        lobbyScreen.classList.add('hidden');
        callScreen.classList.remove('hidden');
      });

      call.on('close', () => {
        alert('A transmissão foi encerrada pelo Host.');
        leaveRoom();
      });

      call.on('error', (err) => {
        console.error('Erro na chamada:', err);
        setStatus('disconnected', 'Erro na conexão');
        alert('Não foi possível conectar à sala. Verifique o ID!');
        btnJoinRoom.disabled = false;
      });
    });

    peer.on('error', (err) => {
      console.error('Erro do PeerJS:', err);
      setStatus('disconnected', 'Falha no servidor');
      alert('Erro ao conectar ao servidor WebRTC: ' + err.type);
      btnJoinRoom.disabled = false;
    });

  } catch (err) {
    console.error('Erro geral ao entrar:', err);
    btnJoinRoom.disabled = false;
    setStatus('disconnected', 'Erro');
  }
}

// 5. Controles de Mídia
btnToggleMic.addEventListener('click', () => {
  if (!localStream) return;
  isMicMuted = !isMicMuted;
  localStream.getAudioTracks().forEach(t => (t.enabled = !isMicMuted));
  btnToggleMic.classList.toggle('active-off', isMicMuted);
  btnToggleMic.querySelector('.label').textContent = isMicMuted ? 'Mutado' : 'Mudo';
});

btnToggleCam.addEventListener('click', () => {
  if (!localStream) return;
  isCamOff = !isCamOff;
  localStream.getVideoTracks().forEach(t => (t.enabled = !isCamOff));
  btnToggleCam.classList.toggle('active-off', isCamOff);
  btnToggleCam.querySelector('.label').textContent = isCamOff ? 'Câm Off' : 'Vídeo';
});

btnFlipCam.addEventListener('click', async () => {
  const nextMode = currentFacingMode === 'user' ? 'environment' : 'user';
  try {
    await startCamera(nextMode);
    // Se estiver em chamada, substitui a track de vídeo
    if (currentCall && currentCall.peerConnection) {
      const senders = currentCall.peerConnection.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      const newVideoTrack = localStream.getVideoTracks()[0];
      if (videoSender && newVideoTrack) {
        videoSender.replaceTrack(newVideoTrack);
      }
    }
  } catch (e) {
    console.warn('Não foi possível alternar câmera:', e);
  }
});

function leaveRoom() {
  if (currentCall) {
    try { currentCall.close(); } catch (e) {}
    currentCall = null;
  }
  if (peer) {
    try { peer.destroy(); } catch (e) {}
    peer = null;
  }
  setStatus('disconnected', 'Desconectado');
  callScreen.classList.add('hidden');
  lobbyScreen.classList.remove('hidden');
  btnJoinRoom.disabled = false;
}

btnLeaveRoom.addEventListener('click', leaveRoom);
btnJoinRoom.addEventListener('click', joinRoom);

// Iniciação
window.addEventListener('DOMContentLoaded', () => {
  initUrlParams();
  // Tenta ligar a câmera antecipadamente para preview
  startCamera('user').catch(() => {
    // Permissão será pedida ao clicar em entrar
  });
});
