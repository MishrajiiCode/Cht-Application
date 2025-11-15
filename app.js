
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
  // Note: messagingSenderId is required for Phone Auth with reCAPTCHA
  messagingSenderId: "500272685848",
  appId: "1:500272685848:web:a943c76811f93514f3746d"
};

// Initialize Firebase
let auth, db, storage;
try {
  firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();
  db = firebase.firestore();
  storage = firebase.storage();
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
let phoneAuthConfirmationResult = null;
let userChats = {};
let unsubscribeUserListener = null;
let unsubscribeCallListener = null;
let unsubscribeChatPreviews = null;

// WebRTC state
let peerConnection;
let localStream;

// App Configuration
const APP_CONFIG = {
  version: '1.2.0',
  releaseNotes: {
    '1.2.0': {
      title: "What's New in Sync v1.2.0",
      features: [
        "**App Renamed to 'Sync'**: The application has a new name and identity!",
        "**'About' Section**: Learn more about the app, its developer, and future goals in the new 'About' section, accessible from the sidebar.",
        "**'What's New' Pop-ups**: You'll now see this message when new features are released!",
      ]
    }
  }
};

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

function showSuccess(elementId, message) {
  const successElement = document.getElementById(elementId);
  successElement.textContent = message;
  successElement.classList.add('show');
  setTimeout(() => {
    successElement.classList.remove('show');
    successElement.textContent = '';
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

function isUserOnline(user) {
  if (!user || !user.lastSeen) return false;
  const lastSeenDate = user.lastSeen.toDate();
  const now = new Date();
  // Consider online if last seen within the last 2 minutes
  return (now - lastSeenDate) < 2 * 60 * 1000;
}

// ==========================================
// AUTHENTICATION FUNCTIONS
// ==========================================

async function handleLoginOrRegister() {
  const name = document.getElementById('loginName').value.trim();
  const pin = document.getElementById('loginPin').value;

  if (!name || !pin) {
    showError('loginError', 'Name and PIN are required.');
    return;
  }

  showLoading(true);
  clearError('loginError');

  try {
    // 1. Check if a user with this name already exists
    const userQuery = await db.collection('users').where('name', '==', name).limit(1).get();

    if (userQuery.empty) {
      // --- User does NOT exist: Register a new user ---
      console.log(`User '${name}' not found. Registering...`);

      if (!/^\d{4}$/.test(pin)) {
        showError('loginError', 'PIN must be exactly 4 digits.');
        showLoading(false);
        return;
      }

      // Create a fake email and a secure password for Firebase Auth. This is invisible to the user.
      const sanitizedName = name.toLowerCase().replace(/\s/g, '_').replace(/[^a-z0-9_]/g, '');
      const email = `${sanitizedName}@chatapp.com`;
      const hiddenPassword = `SECURE_PASS_FOR_${email}_${pin}`;

      // Create user in Firebase Auth
      const userCredential = await auth.createUserWithEmailAndPassword(email, hiddenPassword);
      const userId = userCredential.user.uid;

      // Store user data in Firestore
      await db.collection('users').doc(userId).set({
        name: name,
        email: email, // Store the fake email for auth purposes
        pin: pin, // Store the user's PIN
        avatarUrl: '', // Add avatarUrl field
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      console.log('User registered successfully:', userId);
      // The onAuthStateChanged listener will handle session initialization.

    } else {
      // --- User EXISTS: Attempt to log in ---
      console.log(`User '${name}' found. Attempting login...`);
      const userDocData = userQuery.docs[0].data();

      // Check if the entered PIN matches the stored PIN
      if (userDocData.pin !== pin) {
        showError('loginError', 'Incorrect PIN.');
        showLoading(false);
        return;
      }

      // If name and PIN are correct, construct the hidden credentials and sign in
      const email = userDocData.email;
      const hiddenPassword = `SECURE_PASS_FOR_${email}_${userDocData.pin}`;

      // Authenticate with Firebase Auth
      const userCredential = await auth.signInWithEmailAndPassword(email, hiddenPassword);
      const userId = userCredential.user.uid;

      console.log('User logged in successfully:', userId);
      // The onAuthStateChanged listener will handle session initialization.
    }
  } catch (error) {
    console.error('Login error:', error);
    let errorMessage = 'Login failed. Please check your credentials.';
    if (error.code === 'auth/too-many-requests') {
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
      lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
      isOnline: true
    });

    // Show chat screen
    showChatScreen();
    
    // Load users and chats
    await loadUsers();
    
    // Check for app updates and show 'What's New' modal if needed
    checkVersionAndShowUpdate();

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
  
  // Display current user info in the header profile card
  document.getElementById('headerUserName').textContent = currentUser.name;
  const headerAvatar = document.getElementById('headerAvatar');
  if (currentUser.avatarUrl) {
    headerAvatar.innerHTML = `<img src="${currentUser.avatarUrl}" alt="${currentUser.name}">`;
  } else {
    headerAvatar.innerHTML = currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  }
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
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        isOnline: false
      });
    }

    // Unsubscribe from listeners
    if (unsubscribeMessages) {
      unsubscribeMessages();
      unsubscribeMessages = null;
    }

    if (unsubscribeUserListener) {
      unsubscribeUserListener();
      unsubscribeUserListener = null;
    }

    if (unsubscribeCallListener) {
      unsubscribeCallListener();
      unsubscribeCallListener = null;
    }

    if (unsubscribeChatPreviews) {
      unsubscribeChatPreviews();
      unsubscribeChatPreviews = null;
    }

    // Sign out from Firebase
    await auth.signOut();

    // Clear state
    currentUser = null;
    activeChat = null;
    allUsers = [];
    userChats = {};
    phoneAuthConfirmationResult = null;

    // Show auth screen
    document.getElementById('chatScreen').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    document.querySelector('.chat-container').classList.remove('chat-active');
    
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
        if (unsubscribeUserListener) {
            unsubscribeUserListener();
        }
        // Use onSnapshot for real-time user updates (online status, avatar, etc.)
        unsubscribeUserListener = db.collection('users')
            .orderBy('name')
            .onSnapshot(async (usersSnapshot) => {
                console.log("User list updated from Firestore.");
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
                // renderUserList is now called inside loadChatPreviews's listener

                // Listen for incoming calls
                listenForIncomingCalls();
            }, error => {
                console.error('Error listening to users collection:', error);
            });
    } catch (error) {
        console.error('Error setting up user listener:', error);
    }
}

async function loadChatPreviews() {
    // Unsubscribe from any previous listener before attaching a new one
    if (unsubscribeChatPreviews) {
        unsubscribeChatPreviews();
    }

    unsubscribeChatPreviews = db.collection('chats').where('participants', 'array-contains', currentUser.uid)
        .onSnapshot(snapshot => { // This listener will now be stored and can be detached
            snapshot.docChanges().forEach(change => {
                if (change.type === "added" || change.type === "modified") {
                    const chatData = change.doc.data();
                    const otherUserId = chatData.participants.find(id => id !== currentUser.uid);
                    if (otherUserId) {
                        userChats[otherUserId] = chatData;
                    }
                }
            });
            renderUserList(); // Re-render the list whenever a chat preview updates
        }, error => {
            console.error("Error listening to chat previews:", error);
        });
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
    const lastMessageText = lastMessage?.text || 'No messages yet';
    const isActive = activeChat && activeChat.uid === user.uid;

    const userItem = document.createElement('div');
    userItem.className = `user-item ${isActive ? 'active' : ''}`;
    userItem.onclick = () => openChat(user);

    let avatarContent = '';
    if (user.avatarUrl) {
      avatarContent = `<img src="${user.avatarUrl}" alt="${user.name}">`;
    } else {
      avatarContent = user.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    }

    const isOnline = isUserOnline(user);

    userItem.innerHTML = `
      <div class="user-avatar">
        ${avatarContent}
        ${isOnline ? '<div class="online-indicator"></div>' : ''}
      </div>
      <div class="user-item-content">
        <div class="user-item-header">
          <span class="user-item-name">${user.name}</span>
          ${lastMessage ? `<span class="last-message-time">${formatTimestamp(lastMessage.timestamp)}</span>` : ''}
        </div>
        <div class="last-message">
            ${lastMessageText}
        </div>
      </div>
    `;

    userListContainer.appendChild(userItem);
  });
}
function getInitials(name) {
    if (!name) return '';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
}

// ==========================================
// CHAT FUNCTIONS
// ==========================================

let activeUserListener = null;
let typingIndicatorListener = null;
function updateVideoCallButton(user) {
    document.getElementById('videoCallButton').disabled = !isUserOnline(user);
}

async function openChat(user) {
  // Unsubscribe from previous chat
  if (unsubscribeMessages) {
    unsubscribeMessages();
  }
  if (typingIndicatorListener) {
    typingIndicatorListener();
    typingIndicatorListener = null;
  }


  activeChat = user;

  // Listen for real-time updates on the active user (for online status)
  if (activeUserListener) activeUserListener();
  activeUserListener = db.collection('users').doc(activeChat.uid).onSnapshot(doc => {
      const updatedUser = { uid: doc.id, ...doc.data() };
      activeChat = updatedUser; 
      updateVideoCallButton(updatedUser);

      // Update user status in the chat header
      const statusElement = document.getElementById('chatUserStatus');
      if (isUserOnline(updatedUser)) {
        statusElement.textContent = 'Online';
        statusElement.classList.add('online');
      } else {
        statusElement.textContent = `Last seen ${formatTimestamp(updatedUser.lastSeen)}`;
        statusElement.classList.remove('online');
      }
  });

  const chatId = getChatId(currentUser.uid, activeChat.uid);
  const chatRef = db.collection('chats').doc(chatId);

  // Listen for typing indicator changes
  const typingIndicator = document.getElementById('typingIndicator');
  typingIndicatorListener = chatRef.onSnapshot(doc => {
    if (doc.exists) {
      const chatData = doc.data();
      if (chatData.typingUser === activeChat.uid && chatData.isTyping) {
        typingIndicator.style.display = 'block';
      } else {
        typingIndicator.style.display = 'none';
      }
    } else {
      console.log("No such document!");
    }
  });


  // Update UI
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('activeChat').style.display = 'flex';
  document.getElementById('chatUserName').textContent = user.name;
  
  const chatAvatar = document.getElementById('chatAvatar');
  if (user.avatarUrl) {
    chatAvatar.innerHTML = `<img src="${user.avatarUrl}" alt="${user.name}">`;
  } else {
    chatAvatar.innerHTML = user.name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  }

  document.getElementById('messagesContainer').innerHTML = '';
  document.getElementById('messageInput').value = '';
  updateVideoCallButton(user);

  // Update active state in user list
  renderUserList();

  // On mobile, switch view to the chat area
  document.querySelector('.chat-container').classList.add('chat-active');

  // Load messages
  loadMessages();

  // Add scroll listener for the "Scroll to Bottom" button
  const messagesContainer = document.getElementById('messagesContainer');
  const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
  
  messagesContainer.onscroll = () => {
    // Show button if user has scrolled up more than 300px
    if (messagesContainer.scrollHeight - messagesContainer.scrollTop > messagesContainer.clientHeight + 300) {
      scrollToBottomBtn.style.display = 'block';
    } else {
      scrollToBottomBtn.style.display = 'none';
    }
  };

  scrollToBottomBtn.onclick = () => messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
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
      const isScrolledToBottom = messagesContainer.scrollHeight - messagesContainer.clientHeight <= messagesContainer.scrollTop + 300;

      if (snapshot.empty) {
        messagesContainer.innerHTML = '<div class="empty-state-content" style="padding: var(--space-20);"><p>No messages yet. Start the conversation!</p></div>';
      }
      
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          renderMessage(change.doc.id, change.doc.data());
        }
        if (change.type === 'removed') {
          const messageElement = document.getElementById(`message-${change.doc.id}`);
          if (messageElement) {
            messageElement.remove();
          }
        }
      });

      // Scroll to bottom only if the user was already at the bottom
      if (isScrolledToBottom) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }, error => {
      console.error('Error listening to messages:', error);
    });
}

function renderMessage(messageId, message) {
  const messagesContainer = document.getElementById('messagesContainer');
  const isSent = message.senderId === currentUser.uid;

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isSent ? 'sent' : 'received'}`; 
  messageDiv.id = `message-${messageId}`;

  let bubbleContent = '';
  if (message.type === 'image' && message.imageUrl) {
    bubbleContent = `<img src="${message.imageUrl}" alt="Sent image" class="message-image" onclick="window.open('${message.imageUrl}', '_blank')">`;
  } else {
    bubbleContent = `
      ${!isSent ? `<div class="message-sender">${message.senderName}</div>` : ''}
      <div class="message-text">${escapeHtml(message.text)}</div>
    `;
  }

  let deleteButton = '';
  if (isSent) {
    deleteButton = `<button class="delete-message-btn" onclick="confirmDeleteMessage('${messageId}')" title="Delete Message">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
    </button>`;
  }

  messageDiv.innerHTML = `
    ${deleteButton}
    <div class="message-bubble ${message.type === 'image' ? 'image-only' : ''}">
      ${bubbleContent}
      <div class="message-time">${formatTime(message.timestamp)}</div>
    </div>
  `;

  messagesContainer.appendChild(messageDiv);
}

function confirmDeleteMessage(messageId) {
  if (confirm('Are you sure you want to delete this message? This cannot be undone.')) {
    deleteMessage(messageId);
  }
}

async function deleteMessage(messageId) {
  if (!activeChat) return;

  const chatId = getChatId(currentUser.uid, activeChat.uid);
  const messageRef = db.collection('chats').doc(chatId).collection('messages').doc(messageId);

  try {
    // Check if this is the last message
    const chatRef = db.collection('chats').doc(chatId);
    const chatDoc = await chatRef.get();
    const lastMessage = chatDoc.data().lastMessage;

    // Firestore timestamps can be tricky to compare directly before they are written.
    // A simple check on text and sender is usually sufficient here.
    const messageDoc = await messageRef.get();
    const messageText = messageDoc.data().imageUrl ? '📷 Image' : messageDoc.data().text;

    if (lastMessage && lastMessage.text === messageText && lastMessage.senderId === currentUser.uid) {
      // This is the last message, so we need to find the new last message.
      const newLastMessageQuery = await chatRef.collection('messages')
        .orderBy('timestamp', 'desc')
        .limit(2)
        .get();
      
      const newLastMessageDoc = newLastMessageQuery.docs[1]; // The second to last message
      const newLastMessage = newLastMessageDoc ? newLastMessageDoc.data() : null;

      await chatRef.update({ lastMessage: newLastMessage || null });
    }

    // Finally, delete the message
    await messageRef.delete();
  } catch (error) {
    console.error("Error deleting message:", error);
    alert("Failed to delete message.");
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function sendMessage(messageData) {
  const messageInput = document.getElementById('messageInput');
  const text = messageData?.text || messageInput.value.trim();

  setTypingStatus(false);
  if (!activeChat || (!text && !messageData?.imageUrl)) {
    return;
  }

  if (!messageData?.imageUrl) {
    messageInput.value = '';
    messageInput.focus();
  }

  try {
    const chatId = getChatId(currentUser.uid, activeChat.uid);
    const chatRef = db.collection('chats').doc(chatId);

    const lastMessageText = messageData?.imageUrl ? '📷 Image' : text;

    const messagePayload = { ...messageData, text: text };

    // Create chat document if it doesn't exist
    const chatDocSnapshot = await chatRef.get();

    // Add message to subcollection
    const messageRef = chatRef.collection('messages').doc();
    const messageTimestamp = firebase.firestore.FieldValue.serverTimestamp();

    const lastMessagePayload = {
      text: lastMessageText,
      senderId: currentUser.uid,
      senderName: currentUser.name,
      timestamp: messageTimestamp
    };

    if (!chatDocSnapshot.exists) {
      // If chat doesn't exist, create it and add the first message in a batch
      const batch = db.batch();
      batch.set(chatRef, {
        participants: [currentUser.uid, activeChat.uid],
        lastMessage: lastMessagePayload,
        lastUpdated: messageTimestamp
      });
      batch.set(messageRef, { ...messagePayload, senderId: currentUser.uid, senderName: currentUser.name, timestamp: messageTimestamp });
      await batch.commit();
    } else {
      // If chat exists, add the message and update the lastMessage field
      const batch = db.batch();
      batch.set(messageRef, { ...messagePayload, senderId: currentUser.uid, senderName: currentUser.name, timestamp: messageTimestamp });
      batch.update(chatRef, { lastMessage: lastMessagePayload, lastUpdated: messageTimestamp });
      await batch.commit();
    }

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
    sendMessage({ text: document.getElementById('messageInput').value });
  }
}

function showUserListOnMobile() {
  document.querySelector('.chat-container').classList.remove('chat-active');
  activeChat = null;
  renderUserList(); // Re-render to remove active state
}

async function handleImageUpload(event) {
  const file = event.target.files[0];
  if (!file || !activeChat) return;

  // Reset file input to allow uploading the same file again
  event.target.value = '';

  if (!file.type.startsWith('image/')) {
    alert('Please select an image file.');
    return;
  }

  showLoading(true);

  try {
    const chatId = getChatId(currentUser.uid, activeChat.uid);
    const timestamp = Date.now();
    const storageRef = storage.ref(`images/${chatId}/${timestamp}-${file.name}`);

    const uploadTask = storageRef.put(file);

    uploadTask.on('state_changed', 
      (snapshot) => {
        // Optional: Update a progress bar here
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        console.log('Upload is ' + progress + '% done');
      }, 
      (error) => {
        console.error('Image upload error:', error);
        alert('Failed to upload image.');
        showLoading(false);
      }, 
      async () => {
        // Upload completed successfully, now get the download URL
        const downloadURL = await uploadTask.snapshot.ref.getDownloadURL();
        
        await sendMessage({
          type: 'image',
          imageUrl: downloadURL,
          text: '' // No text for image messages
        });
        showLoading(false);
      }
    );
  } catch (error) {
    console.error('Error handling image upload:', error);
    showLoading(false);
  }
}

let typingTimer;

function setTypingStatus(isTyping) {
  if (!activeChat) return;
  const chatId = getChatId(currentUser.uid, activeChat.uid);
  const chatRef = db.collection('chats').doc(chatId);

  chatRef.update({
    isTyping: isTyping,
    typingUser: currentUser.uid
  }).catch(e => console.error("Error updating typing status:", e));
}

document.getElementById('messageInput').addEventListener('input', (e) => {
  // Clear any existing timer
  clearTimeout(typingTimer);

  // Set "isTyping" to true immediately
  setTypingStatus(true);

  // Set a timer to turn "isTyping" off after a few seconds of inactivity
  typingTimer = setTimeout(() => {
    setTypingStatus(false);
  }, 2000); // 2 seconds
});

document.getElementById('messageInput').addEventListener('blur', () => {
  // When the input loses focus, turn off typing status
  setTypingStatus(false);
});

document.getElementById('messageInput').addEventListener('keydown', () => {
   // If the user presses the 'Enter' key, stop the typing indicator
   if (event.key === 'Enter' && !event.shiftKey) {
      setTypingStatus(false);
   }
});


// ==========================================
// SETTINGS FUNCTIONS
// ==========================================

const predefinedAvatars = [
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Molly',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Leo',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Lucy',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Max',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Zoe',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Toby',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Misty',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Oscar',
];

let selectedAvatarUrl = null;

function showSettingsModal() {
  selectedAvatarUrl = currentUser.avatarUrl;
  clearError('settingsError');

  // Populate with current user data
  document.getElementById('settingsName').textContent = currentUser.name;

  // Populate avatar selection grid
  const avatarGrid = document.getElementById('avatarSelectionGrid');
  avatarGrid.innerHTML = '';
  predefinedAvatars.forEach(url => {
    const img = document.createElement('img');
    img.src = url;
    img.className = 'avatar-option';
    if (url === selectedAvatarUrl) {
      img.classList.add('selected');
    }
    img.onclick = () => {
      // Remove 'selected' from previously selected avatar
      const currentSelected = avatarGrid.querySelector('.selected');
      if (currentSelected) {
        currentSelected.classList.remove('selected');
      }
      // Add 'selected' to the new one
      img.classList.add('selected');
      selectedAvatarUrl = url;
    };
    avatarGrid.appendChild(img);
  });

  document.getElementById('settingsModal').style.display = 'flex';
}

function hideSettingsModal() {
  document.getElementById('settingsModal').style.display = 'none';
  // Clear password fields
  document.getElementById('currentPin').value = '';
  document.getElementById('newPin').value = '';
}

async function saveSettings() {
  showLoading(true);
  clearError('settingsError');

  try {
    const updateData = {
      avatarUrl: selectedAvatarUrl,
    };

    const newPin = document.getElementById('newPin').value;
    const currentPin = document.getElementById('currentPin').value;

    // Handle PIN change
    if (newPin) {
      if (!/^\d{4}$/.test(newPin)) {
        showError('settingsError', 'New PIN must be 4 digits.');
        showLoading(false);
        return;
      }
      if (currentPin !== currentUser.pin) {
        showError('settingsError', 'The current PIN you entered is incorrect.');
        showLoading(false);
        return;
      }
      updateData.pin = newPin;


      // Also update the master password in Firebase Auth
      // 1. Re-authenticate with the OLD pin to prove identity
      const oldHiddenPassword = `SECURE_PASS_FOR_${currentUser.email}_${currentPin}`;
      const credential = firebase.auth.EmailAuthProvider.credential(
        currentUser.email,
        oldHiddenPassword
      );
      await auth.currentUser.reauthenticateWithCredential(credential);

      // 2. If successful, update to the NEW hidden password
      const newHiddenPassword = `SECURE_PASS_FOR_${currentUser.email}_${newPin}`;
      await auth.currentUser.updatePassword(newHiddenPassword);
      console.log("Firebase Auth password updated successfully.");
    }

    // Since name is the unique ID, we don't allow changing it.
    await db.collection('users').doc(currentUser.uid).update(updateData);

    // Update local currentUser object
    currentUser = { ...currentUser, ...updateData };

    // Refresh UI
    showChatScreen(); // To update header
    await loadUsers(); // To update user list

    showLoading(false);
    hideSettingsModal();
    alert('Profile updated successfully!');

  } catch (error) {
    console.error('Error saving settings:', error);
    let errorMessage = 'Failed to save settings. Please try again.';
    if (error.code === 'auth/wrong-password') {
      errorMessage = 'The current PIN you entered is incorrect.';
    }
    showError('settingsError', errorMessage);
    showLoading(false);
  }
}

// ==========================================
// ABOUT & WHAT'S NEW MODAL FUNCTIONS
// ==========================================

function showAboutModal() {
  document.getElementById('aboutModal').style.display = 'flex';
  document.getElementById('appVersion').textContent = `Version ${APP_CONFIG.version}`;
}

function hideAboutModal() {
  document.getElementById('aboutModal').style.display = 'none';
}

function checkVersionAndShowUpdate() {
  const lastSeenVersion = localStorage.getItem('lastSeenVersion');
  const currentVersion = APP_CONFIG.version;

  if (lastSeenVersion !== currentVersion) {
    const release = APP_CONFIG.releaseNotes[currentVersion];
    if (release) {
      showWhatsNewModal(release);
    }
  }
}

function showWhatsNewModal(release) {
  const modal = document.getElementById('whatsNewModal');
  const featuresHtml = release.features.map(feature => `<li>${feature.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')}</li>`).join('');

  modal.innerHTML = `
    <div class="modal-content">
        <div class="modal-header">
            <h2>${release.title}</h2>
        </div>
        <div class="modal-body">
            <p>Here are the latest updates to your favorite chat app:</p>
            <ul>
                ${featuresHtml}
            </ul>
        </div>
        <div class="modal-footer">
            <button onclick="hideWhatsNewModal()" class="btn btn--primary">Got it!</button>
        </div>
    </div>
  `;
  modal.style.display = 'flex';
}

function hideWhatsNewModal() {
  document.getElementById('whatsNewModal').style.display = 'none';
  localStorage.setItem('lastSeenVersion', APP_CONFIG.version);
}

// ==========================================
// VIDEO CALL FUNCTIONS (WebRTC)
// ==========================================

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

async function startVideoCall() {
  if (!activeChat) return;

  const callId = getChatId(currentUser.uid, activeChat.uid);
  const callDocRef = db.collection('calls').doc(callId);

  // Sub-collections for ICE candidates
  const offerCandidates = callDocRef.collection('offerCandidates');
  const answerCandidates = callDocRef.collection('answerCandidates');

  // Show video overlay
  document.getElementById('videoCallOverlay').style.display = 'flex';
  document.getElementById('callStatus').textContent = `Calling ${activeChat.name}...`;

  // Get local media with error handling
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (error) {
    console.error("Error accessing media devices.", error);
    let errorMessage = "Could not access camera and microphone. Please ensure you have granted permission in your browser settings.";
    if (error.name === 'NotAllowedError' || error.name === 'NotFoundError') {
      errorMessage = "Camera/microphone access is required for video calls. If you are using the installed app, this feature may not be supported. Please try using Sync in your mobile web browser (like Chrome or Safari) instead.";
    }
    alert(errorMessage);
    document.getElementById('videoCallOverlay').style.display = 'none';
    return;
  }
  document.getElementById('localVideo').srcObject = localStream;

  // Create Peer Connection
  peerConnection = new RTCPeerConnection(servers);

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  // Listen for remote stream
  peerConnection.ontrack = event => {
    document.getElementById('remoteVideo').srcObject = event.streams[0];
    document.getElementById('callStatus').style.display = 'none';
  };

  // Listen for ICE candidates and add them to Firestore
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      offerCandidates.add(event.candidate.toJSON());
    }
  };

  // Listen for connection state changes
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'disconnected' || 
        peerConnection.connectionState === 'closed' || 
        peerConnection.connectionState === 'failed') {
      endVideoCall(false);
    }
  };

  // Create offer and set local description
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  // Create call document in Firestore
  await callDocRef.set({
    offer: { sdp: offer.sdp, type: offer.type },
    callerId: currentUser.uid,
    calleeId: activeChat.uid,
    status: 'ringing'
  });

  // Listen for answer and ICE candidates from callee
  callDocRef.onSnapshot(async (snapshot) => {
    const data = snapshot.data();
    if (data.answer && !peerConnection.currentRemoteDescription) {
      const answerDescription = new RTCSessionDescription(data.answer);
      await peerConnection.setRemoteDescription(answerDescription);
    }
    if (data.status === 'declined' || data.status === 'ended') {
      await endVideoCall(false); // Don't update Firestore again
    }
  });

  // Listen for ICE candidates from the callee
  answerCandidates.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      }
    });
  });
}

function listenForIncomingCalls() {
  if (unsubscribeCallListener) unsubscribeCallListener();

  unsubscribeCallListener = db.collection('calls')
    .where('calleeId', '==', currentUser.uid)
    .where('status', '==', 'ringing')
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async change => {
        if (change.type === 'added') {
          const callData = change.doc.data();
          const caller = allUsers.find(u => u.uid === callData.callerId);
          if (caller) {
            showIncomingCallModal(caller, change.doc.id, callData.offer);
          }
        }
      });
    });
}

function showIncomingCallModal(caller, callId, offer) {
  const modal = document.getElementById('incomingCallModal');
  modal.innerHTML = `
    <div class="incoming-call-content">
      <p>${caller.name} is calling...</p>
      <div class="incoming-call-actions">
        <button onclick="answerCall('${callId}', \`${JSON.stringify(offer)}\`)" class="btn btn--primary btn--sm">Accept</button>
        <button onclick="declineCall('${callId}')" class="btn btn--secondary btn--sm">Decline</button>
      </div>
    </div>
  `;
  modal.style.display = 'block';
}

async function answerCall(callId, offerString) {
  const offer = JSON.parse(offerString);
  const callDocRef = db.collection('calls').doc(callId);

  // Sub-collections for ICE candidates
  const offerCandidates = callDocRef.collection('offerCandidates');
  const answerCandidates = callDocRef.collection('answerCandidates');

  document.getElementById('incomingCallModal').style.display = 'none';
  document.getElementById('videoCallOverlay').style.display = 'flex';
  document.getElementById('callStatus').textContent = 'Connecting...';

  // Get local media with error handling
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (error) {
    console.error("Error accessing media devices.", error);
    let errorMessage = "Could not access camera and microphone. Please ensure you have granted permission in your browser settings.";
    if (error.name === 'NotAllowedError' || error.name === 'NotFoundError') {
      errorMessage = "Camera/microphone access is required for video calls. If you are using the installed app, this feature may not be supported. Please try using Sync in your mobile web browser (like Chrome or Safari) instead.";
    }
    alert(errorMessage);
    document.getElementById('videoCallOverlay').style.display = 'none';
    declineCall(callId); // Decline the call if media is not available
    return;
  }
  document.getElementById('localVideo').srcObject = localStream;

  peerConnection = new RTCPeerConnection(servers);
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.ontrack = event => {
    document.getElementById('remoteVideo').srcObject = event.streams[0];
    document.getElementById('callStatus').style.display = 'none';
  };

  // Listen for ICE candidates and add them to Firestore
  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      answerCandidates.add(event.candidate.toJSON());
    }
  };

  // Listen for connection state changes
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'disconnected' || 
        peerConnection.connectionState === 'closed' || 
        peerConnection.connectionState === 'failed') {
      endVideoCall(false);
    }
  };

  await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  await callDocRef.update({
    answer: { sdp: answer.sdp, type: answer.type },
    status: 'active'
  });

  // Listen for ICE candidates from the caller
  offerCandidates.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
      }
    });
  });
}

async function declineCall(callId) {
  document.getElementById('incomingCallModal').style.display = 'none';
  const callDocRef = db.collection('calls').doc(callId);
  await callDocRef.update({ status: 'declined' });
}

async function endVideoCall(updateDb = true) {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  document.getElementById('videoCallOverlay').style.display = 'none';
  document.getElementById('localVideo').srcObject = null;
  document.getElementById('remoteVideo').srcObject = null;

  if (updateDb && activeChat) {
    const callId = getChatId(currentUser.uid, activeChat.uid);
    const callDocRef = db.collection('calls').doc(callId);
    const callDoc = await callDocRef.get();
    if (callDoc.exists) {
      await callDocRef.update({ status: 'ended' });
      // Clean up ICE candidate sub-collections
      const offerCandidates = await callDocRef.collection('offerCandidates').get();
      offerCandidates.forEach(async doc => await doc.ref.delete());
      
      const answerCandidates = await callDocRef.collection('answerCandidates').get();
      answerCandidates.forEach(async doc => await doc.ref.delete());

      // Delete the call document after a short delay
      setTimeout(() => {
        callDocRef.delete().catch(e => console.error("Error deleting call doc:", e));
      }, 5000);
    }
  }
}

function initializeEmojiPicker() {
  const emojiButton = document.getElementById('emojiButton');
  const emojiPicker = document.getElementById('emojiPicker');
  const messageInput = document.getElementById('messageInput');

  const emojis = ['😀', '😂', '😍', '🤔', '👍', '👎', '❤️', '🔥', '🎉', '😢', '🙏', '🚀', '💯', '👋', '😊', '😎'];

  emojis.forEach(emoji => {
    const span = document.createElement('span');
    span.textContent = emoji;
    span.onclick = () => {
      messageInput.value += emoji;
      emojiPicker.style.display = 'none';
      messageInput.focus();
    };
    emojiPicker.appendChild(span);
  });

  emojiButton.addEventListener('click', (event) => {
    event.stopPropagation();
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'grid' : 'none';
  });

  document.addEventListener('click', (event) => {
    if (!emojiPicker.contains(event.target) && event.target !== emojiButton) {
      emojiPicker.style.display = 'none';
    }
  });
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

initializeEmojiPicker();
