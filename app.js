// ==========================================
// FIREBASE CONFIGURATION
// ==========================================
// IMPORTANT: Replace this configuration with your own Firebase project credentials
// Get these values from Firebase Console > Project Settings > Your Apps > Firebase SDK snippet

const firebaseConfig = {
  apiKey: "AIzaSyB2VaMVulbRcIZqw5S5eyiBUSRiJNYjooA",
  authDomain: "mychat-app-85bdc.firebaseapp.com",
  projectId: "mychat-app-85bdc",
  storageBucket: "mychat-app-85bdc.appspot.com",
  messagingSenderId: "500272685848",
  appId: "1:500272685848:web:a943c76811f93514f3746d"
};

// Initialize Firebase
let auth, db;
try {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  console.log('Firebase initialized successfully');
} catch (error) {
  console.error('Firebase initialization error:', error);
  alert('Firebase configuration error. Please check your Firebase setup.');
}

// ==========================================
// GLOBAL STATE (In-Memory Storage)
// ==========================================
let currentUser = null;
let activeChat = null;
let unsubscribeMessages = null;
let allUsers = [];
let userChats = {};

// ==========================================
// UTILITY FUNCTIONS
// ==========================================

function showLoading(show = true) {
  const overlay = document.getElementById('loadingOverlay');
  overlay.style.display = show ? 'flex' : 'none';
}

function showError(elementId, message) {
  const errorElement = document.getElementById(elementId);
  errorElement.textContent = message;
  errorElement.classList.add('show');
  setTimeout(() => {
    errorElement.classList.remove('show');
  }, 5000);
}

function clearError(elementId) {
  const errorElement = document.getElementById(elementId);
  errorElement.textContent = '';
  errorElement.classList.remove('show');
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  
  return date.toLocaleDateString();
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function getChatId(userId1, userId2) {
  return [userId1, userId2].sort().join('_');
}

// ==========================================
// AUTHENTICATION FUNCTIONS
// ==========================================

function showLoginForm() {
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('registerForm').style.display = 'none';
  clearError('loginError');
  clearError('registerError');
}

function showRegisterForm() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
  clearError('loginError');
  clearError('registerError');
}

async function handleRegister() {
  const name = document.getElementById('registerName').value.trim();
  const mobile = document.getElementById('registerMobile').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;

  // Validation
  if (!name || !mobile || !email || !password) {
    showError('registerError', 'All fields are required');
    return;
  }

  if (password.length < 6) {
    showError('registerError', 'Password must be at least 6 characters');
    return;
  }

  if (!email.includes('@')) {
    showError('registerError', 'Please enter a valid email address');
    return;
  }

  showLoading(true);
  clearError('registerError');

  try {
    // Create user in Firebase Auth
    const userCredential = await auth.createUserWithEmailAndPassword(email, password);
    const userId = userCredential.user.uid;

    // Store additional user data in Firestore
    await db.collection('users').doc(userId).set({
      name: name,
      mobile: mobile,
      email: email,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    });

    console.log('User registered successfully:', userId);
    
    // Auto-login after registration
    await initializeUserSession(userId);
    
  } catch (error) {
    console.error('Registration error:', error);
    let errorMessage = 'Registration failed. Please try again.';
    
    if (error.code === 'auth/email-already-in-use') {
      errorMessage = 'This email is already registered. Please login instead.';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email address.';
    } else if (error.code === 'auth/weak-password') {
      errorMessage = 'Password is too weak.';
    }
    
    showError('registerError', errorMessage);
    showLoading(false);
  }
}

async function handleLogin() {
  const emailOrMobile = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!emailOrMobile || !password) {
    showError('loginError', 'Please enter your credentials');
    return;
  }

  showLoading(true);
  clearError('loginError');

  try {
    // If input looks like a mobile number, find the email associated with it
    let email = emailOrMobile;
    if (!emailOrMobile.includes('@')) {
      // Search for user by mobile number
      const userQuery = await db.collection('users')
        .where('mobile', '==', emailOrMobile)
        .limit(1)
        .get();
      
      if (userQuery.empty) {
        showError('loginError', 'No account found with this mobile number');
        showLoading(false);
        return;
      }
      
      email = userQuery.docs[0].data().email;
    }

    // Authenticate with Firebase Auth
    const userCredential = await auth.signInWithEmailAndPassword(email, password);
    const userId = userCredential.user.uid;

    console.log('User logged in successfully:', userId);
    
    await initializeUserSession(userId);
    
  } catch (error) {
    console.error('Login error:', error);
    let errorMessage = 'Login failed. Please check your credentials.';
    
    if (error.code === 'auth/user-not-found') {
      errorMessage = 'No account found. Please register first.';
    } else if (error.code === 'auth/wrong-password') {
      errorMessage = 'Incorrect password.';
    } else if (error.code === 'auth/invalid-email') {
      errorMessage = 'Invalid email address.';
    } else if (error.code === 'auth/too-many-requests') {
      errorMessage = 'Too many failed attempts. Please try again later.';
    }
    
    showError('loginError', errorMessage);
    showLoading(false);
  }
}

async function initializeUserSession(userId) {
  try {
    // Fetch user data from Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      throw new Error('User data not found');
    }

    currentUser = {
      uid: userId,
      ...userDoc.data()
    };

    // Update last seen
    await db.collection('users').doc(userId).update({
      lastSeen: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Show chat screen
    showChatScreen();
    
    // Load users and chats
    await loadUsers();
    
    showLoading(false);
    
  } catch (error) {
    console.error('Session initialization error:', error);
    showError('loginError', 'Failed to initialize session');
    showLoading(false);
  }
}

function showChatScreen() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('chatScreen').style.display = 'flex';
  
  // Display current user info
  document.getElementById('currentUserInfo').textContent = 
    `${currentUser.name} (${currentUser.mobile})`;
}

async function handleLogout() {
  if (!confirm('Are you sure you want to logout?')) {
    return;
  }

  showLoading(true);

  try {
    // Update last seen before logout
    if (currentUser) {
      await db.collection('users').doc(currentUser.uid).update({
        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    // Unsubscribe from listeners
    if (unsubscribeMessages) {
      unsubscribeMessages();
      unsubscribeMessages = null;
    }

    // Sign out from Firebase
    await auth.signOut();

    // Clear state
    currentUser = null;
    activeChat = null;
    allUsers = [];
    userChats = {};

    // Show auth screen
    document.getElementById('chatScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    
    showLoading(false);
    console.log('Logged out successfully');
    
  } catch (error) {
    console.error('Logout error:', error);
    showLoading(false);
  }
}

// ==========================================
// USER LIST FUNCTIONS
// ==========================================

async function loadUsers() {
  try {
    // Fetch all users except current user
    const usersSnapshot = await db.collection('users')
      .orderBy('name')
      .get();

    allUsers = [];
    usersSnapshot.forEach(doc => {
      if (doc.id !== currentUser.uid) {
        allUsers.push({
          uid: doc.id,
          ...doc.data()
        });
      }
    });

    // Fetch last messages for all chats
    await loadChatPreviews();

    renderUserList();
    
  } catch (error) {
    console.error('Error loading users:', error);
  }
}

async function loadChatPreviews() {
  try {
    const chatsSnapshot = await db.collection('chats')
      .where('participants', 'array-contains', currentUser.uid)
      .get();

    userChats = {};
    chatsSnapshot.forEach(doc => {
      const chatData = doc.data();
      const otherUserId = chatData.participants.find(id => id !== currentUser.uid);
      userChats[otherUserId] = chatData;
    });
    
  } catch (error) {
    console.error('Error loading chat previews:', error);
  }
}

function renderUserList() {
  const userListContainer = document.getElementById('userList');
  userListContainer.innerHTML = '';

  if (allUsers.length === 0) {
    userListContainer.innerHTML = `
      <div style="padding: var(--space-24); text-align: center; color: var(--color-text-secondary);">
        <p>No other users found.</p>
        <p style="margin-top: var(--space-8); font-size: var(--font-size-sm);">Ask your friends to register!</p>
      </div>
    `;
    return;
  }

  allUsers.forEach(user => {
    const chatData = userChats[user.uid];
    const lastMessage = chatData?.lastMessage;
    const isActive = activeChat && activeChat.uid === user.uid;

    const userItem = document.createElement('div');
    userItem.className = `user-item ${isActive ? 'active' : ''}`;
    userItem.onclick = () => openChat(user);

    const initials = user.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);

    userItem.innerHTML = `
      <div class="user-avatar">
        ${initials}
        <div class="online-indicator"></div>
      </div>
      <div class="user-item-content">
        <div class="user-item-header">
          <span class="user-item-name">${user.name}</span>
          ${lastMessage ? `<span class="last-message-time">${formatTimestamp(lastMessage.timestamp)}</span>` : ''}
        </div>
        <div class="user-item-mobile">${user.mobile}</div>
        ${lastMessage ? `<div class="last-message">${lastMessage.text}</div>` : ''}
      </div>
    `;

    userListContainer.appendChild(userItem);
  });
}

// ==========================================
// CHAT FUNCTIONS
// ==========================================

async function openChat(user) {
  // Unsubscribe from previous chat
  if (unsubscribeMessages) {
    unsubscribeMessages();
  }

  activeChat = user;

  // Update UI
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('activeChat').style.display = 'flex';
  document.getElementById('chatUserName').textContent = user.name;
  document.getElementById('chatUserMobile').textContent = user.mobile;
  document.getElementById('messagesContainer').innerHTML = '';
  document.getElementById('messageInput').value = '';

  // Update active state in user list
  renderUserList();

  // Load messages
  loadMessages();
}

function loadMessages() {
  const chatId = getChatId(currentUser.uid, activeChat.uid);

  // Set up real-time listener for messages
  unsubscribeMessages = db.collection('chats')
    .doc(chatId)
    .collection('messages')
    .orderBy('timestamp', 'asc')
    .onSnapshot(snapshot => {
      const messagesContainer = document.getElementById('messagesContainer');
      messagesContainer.innerHTML = '';

      snapshot.forEach(doc => {
        const message = doc.data();
        renderMessage(message);
      });

      // Scroll to bottom
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, error => {
      console.error('Error listening to messages:', error);
    });
}

function renderMessage(message) {
  const messagesContainer = document.getElementById('messagesContainer');
  const isSent = message.senderId === currentUser.uid;

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;

  messageDiv.innerHTML = `
    <div class="message-bubble">
      ${!isSent ? `<div class="message-sender">${message.senderName}</div>` : ''}
      <div class="message-text">${escapeHtml(message.text)}</div>
      <div class="message-time">${formatTime(message.timestamp)}</div>
    </div>
  `;

  messagesContainer.appendChild(messageDiv);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function sendMessage() {
  const messageInput = document.getElementById('messageInput');
  const text = messageInput.value.trim();

  if (!text || !activeChat) {
    return;
  }

  messageInput.value = '';
  messageInput.focus();

  try {
    const chatId = getChatId(currentUser.uid, activeChat.uid);
    const chatRef = db.collection('chats').doc(chatId);

    // Create chat document if it doesn't exist
    const chatDoc = await chatRef.get();
    if (!chatDoc.exists) {
      await chatRef.set({
        participants: [currentUser.uid, activeChat.uid],
        lastMessage: {
          text: text,
          senderId: currentUser.uid,
          senderName: currentUser.name,
          timestamp: firebase.firestore.FieldValue.serverTimestamp()
        },
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
      });
    }

    // Add message to subcollection
    await chatRef.collection('messages').add({
      senderId: currentUser.uid,
      senderName: currentUser.name,
      text: text,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Update last message in chat document
    await chatRef.update({
      lastMessage: {
        text: text,
        senderId: currentUser.uid,
        senderName: currentUser.name,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      },
      lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    });

    // Refresh chat list to update last message
    await loadChatPreviews();
    renderUserList();
    
  } catch (error) {
    console.error('Error sending message:', error);
    alert('Failed to send message. Please try again.');
  }
}

function handleMessageKeyPress(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

// ==========================================
// INITIALIZATION
// ==========================================

// Check authentication state on page load
auth.onAuthStateChanged(async (user) => {
  if (user) {
    console.log('User already logged in:', user.uid);
    showLoading(true);
    await initializeUserSession(user.uid);
  } else {
    console.log('No user logged in');
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('chatScreen').style.display = 'none';
  }
});

console.log('Chat Application initialized');