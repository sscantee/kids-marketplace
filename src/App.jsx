import React, { useState, useEffect } from 'react';
import { Search, Plus, Tag, Heart, MapPin, Clock, LogOut, User, Upload, X, Edit2, Trash2, ShoppingBag } from 'lucide-react';
import { auth, db, storage, functions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendEmailVerification
} from 'firebase/auth';
import {
  collection,
  addDoc,
  query,
  orderBy,
  where,
  onSnapshot,
  deleteDoc,
  doc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const getAuthErrorMessage = (errorCode) => {
  switch (errorCode) {
    case 'auth/user-not-found':
      return 'No account found with this email.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Invalid email or password.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait and try again.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/network-request-failed':
      return 'Network error. Please check your connection.';
    default:
      return 'Something went wrong. Please try again.';
  }
};

const KidsMarketplace = () => {
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [verificationSent, setVerificationSent] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showMyListings, setShowMyListings] = useState(false);
  const [purchases, setPurchases] = useState([]);
  const [showPurchases, setShowPurchases] = useState(false);

  const [formData, setFormData] = useState({
    title: '',
    price: '',
    category: 'toys',
    condition: 'Like New',
    age: '',
    location: '',
    description: ''
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);
  const [buyLoading, setBuyLoading] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState(null);

  const categories = [
    { id: 'all', label: 'All Items' },
    { id: 'toys', label: 'Toys' },
    { id: 'clothes', label: 'Clothes' },
    { id: 'accessories', label: 'Accessories' }
  ];

  const getSellerDisplayName = () => {
    if (!user) return '';
    if (user.displayName) return user.displayName;
    return user.email.split('@')[0];
  };

  // Auth state listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setShowAuthModal(!currentUser);
    });
    return () => unsubscribe();
  }, []);

  // Real-time listings listener
  useEffect(() => {
    const q = query(collection(db, 'listings'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const listingsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        saved: false
      }));
      setListings(listingsData);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Purchases listener
  useEffect(() => {
    if (!user) { setPurchases([]); return; }
    const q = query(
      collection(db, 'transactions'),
      where('buyerId', '==', user.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPurchases(data);
    });
    return () => unsubscribe();
  }, [user]);

  // Check for payment status in URL params (after Stripe redirect)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');

    if (paymentStatus === 'success') {
      localStorage.removeItem('pendingPurchase');
      setPaymentMessage({
        type: 'success',
        text: 'Payment successful! The item is now yours. The seller will be notified.'
      });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (paymentStatus === 'cancelled') {
      localStorage.removeItem('pendingPurchase');
      setPaymentMessage({
        type: 'cancelled',
        text: 'Payment was cancelled. The item is still available.'
      });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Auth functions
  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    setVerificationSent(false);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(result.user);
        setVerificationSent(true);
        setTimeout(() => setVerificationSent(false), 5000);
      }
      setEmail('');
      setPassword('');
    } catch (error) {
      setAuthError(getAuthErrorMessage(error.code));
    }
  };

  const handleGoogleAuth = async () => {
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setShowAuthModal(false);
    } catch (error) {
      setAuthError(getAuthErrorMessage(error.code));
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Image handling
  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadImage = async (file) => {
    const storageRef = ref(storage, `listings/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    return await getDownloadURL(storageRef);
  };

  // Form handling
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!user) return;

    setUploading(true);
    try {
      let imageUrl = 'https://images.unsplash.com/photo-1558060370-d644479cb6f7?w=400&h=400&fit=crop';

      if (imageFile) {
        imageUrl = await uploadImage(imageFile);
      }

      const listingData = {
        ...formData,
        price: parseFloat(formData.price),
        image: imageUrl,
        seller: user.email,
        sellerId: user.uid,
        sellerDisplayName: getSellerDisplayName(),
        status: 'available',
        createdAt: serverTimestamp()
      };

      if (editingId) {
        await updateDoc(doc(db, 'listings', editingId), {
          ...listingData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'listings'), listingData);
      }

      setFormData({
        title: '',
        price: '',
        category: 'toys',
        condition: 'Like New',
        age: '',
        location: '',
        description: ''
      });
      setImageFile(null);
      setImagePreview(null);
      setShowAddForm(false);
      setEditingId(null);
    } catch (error) {
      console.error('Error adding listing:', error);
      alert('Error adding listing. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleEdit = (listing) => {
    setFormData({
      title: listing.title,
      price: listing.price.toString(),
      category: listing.category,
      condition: listing.condition,
      age: listing.age,
      location: listing.location,
      description: listing.description || ''
    });
    setImagePreview(listing.image);
    setEditingId(listing.id);
    setShowAddForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id) => {
    if (window.confirm('Are you sure you want to delete this listing?')) {
      try {
        await deleteDoc(doc(db, 'listings', id));
      } catch (error) {
        console.error('Error deleting listing:', error);
        alert('Error deleting listing. Please try again.');
      }
    }
  };

  const handleBuyNow = async (listing) => {
    if (!user) return;
    if (listing.sellerId === user.uid) {
      alert('You cannot buy your own item!');
      return;
    }

    setBuyLoading(true);
    try {
      localStorage.setItem('pendingPurchase', JSON.stringify({
        listingId: listing.id,
        title: listing.title,
        price: listing.price
      }));
      const createCheckoutSession = httpsCallable(functions, 'createCheckoutSession');
      const result = await createCheckoutSession({ listingId: listing.id });
      window.location.href = result.data.url;
    } catch (error) {
      console.error('Error creating checkout session:', error);
      localStorage.removeItem('pendingPurchase');
      alert(error.message || 'Failed to start checkout. Please try again.');
    } finally {
      setBuyLoading(false);
    }
  };

  const filteredListings = listings.filter(item => {
    if (showMyListings && user) {
      if (item.sellerId !== user.uid) return false;
    }
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    const matchesSearch = item.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.category?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const toggleSave = (id) => {
    setListings(listings.map(item =>
      item.id === id ? { ...item, saved: !item.saved } : item
    ));
  };

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const seconds = Math.floor((new Date() - date) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
    return `${Math.floor(seconds / 604800)}w ago`;
  };

  const displaySellerName = (item) => {
    return item.sellerDisplayName || item.seller?.split('@')[0] || 'Unknown';
  };

  // Auth Modal
  if (showAuthModal) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#faf8f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        fontFamily: '"DM Sans", sans-serif'
      }}>
        <div style={{
          background: 'white',
          borderRadius: '14px',
          padding: '2.5rem',
          maxWidth: '420px',
          width: '100%',
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
          border: '1px solid #e0dbd4'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h1 style={{
              color: '#2d2d2d',
              fontSize: '1.6rem',
              fontWeight: '700',
              marginBottom: '0.4rem'
            }}>
              Little Treasures
            </h1>
            <p style={{ color: '#6b6b6b', fontSize: '0.95rem', margin: 0 }}>
              {isLogin ? 'Sign in to your account' : 'Create your account'}
            </p>
          </div>

          {authError && (
            <div style={{
              background: '#f9e6e6',
              color: '#c45c5c',
              padding: '0.8rem 1rem',
              borderRadius: '10px',
              marginBottom: '1rem',
              fontSize: '0.9rem',
              border: '1px solid #e8c4c4'
            }}>
              {authError}
            </div>
          )}

          <form onSubmit={handleEmailAuth} style={{ marginBottom: '1.5rem' }}>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.9rem 1rem',
                marginBottom: '0.8rem',
                fontSize: '0.95rem',
                border: '1px solid #e0dbd4',
                borderRadius: '10px',
                outline: 'none',
                background: 'white',
                color: '#2d2d2d'
              }}
              onFocus={(e) => e.target.style.borderColor = '#5c7a5a'}
              onBlur={(e) => e.target.style.borderColor = '#e0dbd4'}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '0.9rem 1rem',
                marginBottom: '1.2rem',
                fontSize: '0.95rem',
                border: '1px solid #e0dbd4',
                borderRadius: '10px',
                outline: 'none',
                background: 'white',
                color: '#2d2d2d'
              }}
              onFocus={(e) => e.target.style.borderColor = '#5c7a5a'}
              onBlur={(e) => e.target.style.borderColor = '#e0dbd4'}
            />
            <button
              type="submit"
              style={{
                width: '100%',
                background: '#5c7a5a',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                padding: '0.9rem',
                fontSize: '1rem',
                fontWeight: '600',
                cursor: 'pointer',
                transition: 'background 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.background = '#4a6849'}
              onMouseOut={(e) => e.currentTarget.style.background = '#5c7a5a'}
            >
              {isLogin ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div style={{
            textAlign: 'center',
            color: '#9a958e',
            marginBottom: '1rem',
            fontSize: '0.85rem',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}>
            or
          </div>

          <button
            onClick={handleGoogleAuth}
            style={{
              width: '100%',
              background: 'white',
              color: '#2d2d2d',
              border: '1px solid #e0dbd4',
              borderRadius: '10px',
              padding: '0.9rem',
              fontSize: '0.95rem',
              fontWeight: '500',
              cursor: 'pointer',
              marginBottom: '1.5rem',
              transition: 'border-color 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.borderColor = '#5c7a5a'}
            onMouseOut={(e) => e.currentTarget.style.borderColor = '#e0dbd4'}
          >
            Continue with Google
          </button>

          <div style={{ textAlign: 'center', fontSize: '0.9rem', color: '#6b6b6b' }}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setAuthError('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#5c7a5a',
                fontWeight: '600',
                cursor: 'pointer',
                textDecoration: 'underline',
                fontSize: '0.9rem'
              }}
            >
              {isLogin ? 'Sign up' : 'Sign in'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#faf8f5',
      fontFamily: '"DM Sans", sans-serif'
    }}>
      {/* Header */}
      <header style={{
        background: 'white',
        padding: '1.2rem 2rem',
        borderBottom: '1px solid #e0dbd4',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.8rem' }}>
            <h1
              style={{
                color: '#2d2d2d',
                fontSize: '1.5rem',
                fontWeight: '700',
                margin: 0,
                cursor: 'pointer'
              }}
              onClick={() => { setShowMyListings(false); setShowPurchases(false); }}
            >
              Little Treasures
            </h1>
            <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{
                color: '#6b6b6b',
                fontSize: '0.85rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem'
              }}>
                <User size={15} />
                {user?.displayName || user?.email?.split('@')[0]}
              </span>
              <button
                onClick={() => { setShowMyListings(!showMyListings); setShowPurchases(false); }}
                style={{
                  background: showMyListings ? '#5c7a5a' : 'white',
                  color: showMyListings ? 'white' : '#6b6b6b',
                  border: showMyListings ? 'none' : '1px solid #e0dbd4',
                  borderRadius: '10px',
                  padding: '0.6rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                My Listings
              </button>
              <button
                onClick={() => { setShowPurchases(!showPurchases); setShowMyListings(false); }}
                style={{
                  background: showPurchases ? '#5c7a5a' : 'white',
                  color: showPurchases ? 'white' : '#6b6b6b',
                  border: showPurchases ? 'none' : '1px solid #e0dbd4',
                  borderRadius: '10px',
                  padding: '0.6rem 1rem',
                  fontSize: '0.85rem',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  transition: 'all 0.2s'
                }}
              >
                <ShoppingBag size={14} />
                Purchases
              </button>
              <button
                onClick={() => { setShowAddForm(!showAddForm); setShowPurchases(false); }}
                style={{
                  background: '#5c7a5a',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.6rem 1.2rem',
                  fontSize: '0.85rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = '#4a6849'}
                onMouseOut={(e) => e.currentTarget.style.background = '#5c7a5a'}
              >
                <Plus size={16} />
                Sell Item
              </button>
              <button
                onClick={handleLogout}
                style={{
                  background: 'white',
                  color: '#6b6b6b',
                  border: '1px solid #e0dbd4',
                  borderRadius: '10px',
                  width: '38px',
                  height: '38px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = '#c45c5c'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = '#e0dbd4'}
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>

          {/* Search Bar */}
          {!showPurchases && (
            <div style={{ position: 'relative' }}>
              <Search
                size={18}
                style={{
                  position: 'absolute',
                  left: '1rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#9a958e',
                  pointerEvents: 'none'
                }}
              />
              <input
                type="text"
                placeholder="Search for toys, clothes, accessories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.8rem 1rem 0.8rem 2.8rem',
                  fontSize: '0.95rem',
                  border: '1px solid #e0dbd4',
                  borderRadius: '10px',
                  outline: 'none',
                  background: '#faf8f5',
                  color: '#2d2d2d'
                }}
                onFocus={(e) => e.target.style.borderColor = '#5c7a5a'}
                onBlur={(e) => e.target.style.borderColor = '#e0dbd4'}
              />
            </div>
          )}
        </div>
      </header>

      {/* Verification Email Banner */}
      {verificationSent && (
        <div style={{
          maxWidth: '1400px',
          margin: '1rem auto 0',
          padding: '0 2rem'
        }}>
          <div style={{
            background: '#e8f0e8',
            color: '#3a5a3a',
            border: '1px solid #c0d4c0',
            borderRadius: '10px',
            padding: '0.8rem 1.2rem',
            fontSize: '0.9rem',
            fontWeight: '500'
          }}>
            Account created! Check your inbox to verify your email.
          </div>
        </div>
      )}

      {/* Unverified Email Reminder */}
      {user && !user.emailVerified && !verificationSent && (
        <div style={{
          maxWidth: '1400px',
          margin: '1rem auto 0',
          padding: '0 2rem'
        }}>
          <div style={{
            background: '#f5f0eb',
            color: '#6b6b6b',
            border: '1px solid #e0dbd4',
            borderRadius: '10px',
            padding: '0.8rem 1.2rem',
            fontSize: '0.85rem'
          }}>
            Please verify your email address. Check your inbox for a verification link.
          </div>
        </div>
      )}

      {/* Payment Status Banner */}
      {paymentMessage && (
        <div style={{
          maxWidth: '1400px',
          margin: '1rem auto 0',
          padding: '0 2rem'
        }}>
          <div style={{
            background: paymentMessage.type === 'success' ? '#e8f0e8' : '#f5f0eb',
            color: paymentMessage.type === 'success' ? '#3a5a3a' : '#8b7355',
            border: `1px solid ${paymentMessage.type === 'success' ? '#c0d4c0' : '#e0dbd4'}`,
            borderRadius: '10px',
            padding: '0.8rem 1.2rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.95rem',
            fontWeight: '500'
          }}>
            <span>{paymentMessage.text}</span>
            <button
              onClick={() => setPaymentMessage(null)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: 'inherit',
                padding: '0.2rem',
                lineHeight: 1
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Category Pills */}
      {!showPurchases && (
        <div style={{
          maxWidth: '1400px',
          margin: '1.5rem auto',
          padding: '0 2rem'
        }}>
          <div style={{
            display: 'flex',
            gap: '0.6rem',
            flexWrap: 'wrap'
          }}>
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                style={{
                  background: selectedCategory === cat.id ? '#5c7a5a' : 'white',
                  color: selectedCategory === cat.id ? 'white' : '#6b6b6b',
                  border: selectedCategory === cat.id ? 'none' : '1px solid #e0dbd4',
                  borderRadius: '10px',
                  padding: '0.6rem 1.2rem',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseOver={(e) => {
                  if (selectedCategory !== cat.id) {
                    e.currentTarget.style.borderColor = '#5c7a5a';
                    e.currentTarget.style.color = '#5c7a5a';
                  }
                }}
                onMouseOut={(e) => {
                  if (selectedCategory !== cat.id) {
                    e.currentTarget.style.borderColor = '#e0dbd4';
                    e.currentTarget.style.color = '#6b6b6b';
                  }
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Add/Edit Listing Form */}
      {showAddForm && (
        <div style={{
          maxWidth: '700px',
          margin: '1.5rem auto',
          padding: '0 2rem'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '14px',
            padding: '2rem',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            border: '1px solid #e0dbd4',
            animation: 'slideDown 0.3s ease',
            position: 'relative'
          }}>
            <button
              onClick={() => {
                setShowAddForm(false);
                setEditingId(null);
                setImagePreview(null);
                setImageFile(null);
                setFormData({
                  title: '',
                  price: '',
                  category: 'toys',
                  condition: 'Like New',
                  age: '',
                  location: '',
                  description: ''
                });
              }}
              style={{
                position: 'absolute',
                top: '1.2rem',
                right: '1.2rem',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#9a958e',
                padding: '0.3rem'
              }}
            >
              <X size={20} />
            </button>
            <h2 style={{
              color: '#2d2d2d',
              fontSize: '1.3rem',
              fontWeight: '600',
              marginBottom: '1.5rem'
            }}>
              {editingId ? 'Edit Your Item' : 'List Your Item'}
            </h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
              {/* Image Upload */}
              <div>
                <label style={{ display: 'block', color: '#2d2d2d', fontWeight: '500', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                  Product Photo
                </label>
                <div style={{
                  border: '1px dashed #e0dbd4',
                  borderRadius: '10px',
                  padding: '1.5rem',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s'
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = '#5c7a5a'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = '#e0dbd4'}
                >
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageChange}
                    style={{ display: 'none' }}
                    id="imageUpload"
                  />
                  <label htmlFor="imageUpload" style={{ cursor: 'pointer' }}>
                    {imagePreview ? (
                      <img src={imagePreview} alt="Preview" style={{
                        maxWidth: '100%',
                        maxHeight: '180px',
                        borderRadius: '8px'
                      }} />
                    ) : (
                      <div>
                        <Upload size={36} color="#9a958e" style={{ marginBottom: '0.5rem' }} />
                        <p style={{ color: '#6b6b6b', fontWeight: '500', margin: '0 0 0.3rem 0', fontSize: '0.9rem' }}>
                          Click to upload image
                        </p>
                        <p style={{ color: '#9a958e', fontSize: '0.8rem', margin: 0 }}>
                          JPG, PNG, or GIF (max 5MB)
                        </p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', color: '#2d2d2d', fontWeight: '500', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                  Item Title *
                </label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  placeholder="E.g., LEGO Castle Set"
                  required
                  style={{
                    width: '100%',
                    padding: '0.8rem 1rem',
                    fontSize: '0.95rem',
                    border: '1px solid #e0dbd4',
                    borderRadius: '10px',
                    outline: 'none',
                    color: '#2d2d2d'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#5c7a5a'}
                  onBlur={(e) => e.target.style.borderColor = '#e0dbd4'}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem' }}>
                <div>
                  <label style={{ display: 'block', color: '#2d2d2d', fontWeight: '500', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                    Price (&euro;) *
                  </label>
                  <input
                    type="number"
                    name="price"
                    value={formData.price}
                    onChange={handleInputChange}
                    placeholder="0"
                    required
                    min="0"
                    step="0.01"
                    style={{
                      width: '100%',
                      padding: '0.8rem 1rem',
                      fontSize: '0.95rem',
                      border: '1px solid #e0dbd4',
                      borderRadius: '10px',
                      outline: 'none',
                      color: '#2d2d2d'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#5c7a5a'}
                    onBlur={(e) => e.target.style.borderColor = '#e0dbd4'}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', color: '#2d2d2d', fontWeight: '500', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                    Category *
                  </label>
                  <select
                    name="category"
                    value={formData.category}
                    onChange={handleInputChange}
                    style={{
                      width: '100%',
                      padding: '0.8rem 1rem',
                      fontSize: '0.95rem',
                      border: '1px solid #e0dbd4',
                      borderRadius: '10px',
                      outline: 'none',
                      color: '#2d2d2d',
                      background: 'white'
                    }}
                  >
                    <option value="toys">Toys</option>
                    <option value="clothes">Clothes</option>
                    <option value="accessories">Accessories</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem' }}>
                <div>
                  <label style={{ display: 'block', color: '#2d2d2d', fontWeight: '500', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                    Condition *
                  </label>
                  <select
                    name="condition"
                    value={formData.condition}
                    onChange={handleInputChange}
                    style={{
                      width: '100%',
                      padding: '0.8rem 1rem',
                      fontSize: '0.95rem',
                      border: '1px solid #e0dbd4',
                      borderRadius: '10px',
                      outline: 'none',
                      color: '#2d2d2d',
                      background: 'white'
                    }}
                  >
                    <option>Like New</option>
                    <option>Excellent</option>
                    <option>Good</option>
                    <option>Fair</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', color: '#2d2d2d', fontWeight: '500', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                    Age Range *
                  </label>
                  <input
                    type="text"
                    name="age"
                    value={formData.age}
                    onChange={handleInputChange}
                    placeholder="E.g., 3-6 years"
                    required
                    style={{
                      width: '100%',
                      padding: '0.8rem 1rem',
                      fontSize: '0.95rem',
                      border: '1px solid #e0dbd4',
                      borderRadius: '10px',
                      outline: 'none',
                      color: '#2d2d2d'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#5c7a5a'}
                    onBlur={(e) => e.target.style.borderColor = '#e0dbd4'}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', color: '#2d2d2d', fontWeight: '500', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                  Location *
                </label>
                <input
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleInputChange}
                  placeholder="City, Country"
                  required
                  style={{
                    width: '100%',
                    padding: '0.8rem 1rem',
                    fontSize: '0.95rem',
                    border: '1px solid #e0dbd4',
                    borderRadius: '10px',
                    outline: 'none',
                    color: '#2d2d2d'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#5c7a5a'}
                  onBlur={(e) => e.target.style.borderColor = '#e0dbd4'}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#2d2d2d', fontWeight: '500', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                  Description
                </label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Tell us about your item..."
                  rows="3"
                  style={{
                    width: '100%',
                    padding: '0.8rem 1rem',
                    fontSize: '0.95rem',
                    border: '1px solid #e0dbd4',
                    borderRadius: '10px',
                    outline: 'none',
                    color: '#2d2d2d',
                    resize: 'vertical'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#5c7a5a'}
                  onBlur={(e) => e.target.style.borderColor = '#e0dbd4'}
                />
              </div>
              <button
                type="submit"
                disabled={uploading}
                style={{
                  background: uploading ? '#9a958e' : '#5c7a5a',
                  color: 'white',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '0.9rem',
                  fontSize: '1rem',
                  fontWeight: '600',
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  transition: 'background 0.2s'
                }}
                onMouseOver={(e) => {
                  if (!uploading) e.currentTarget.style.background = '#4a6849';
                }}
                onMouseOut={(e) => {
                  if (!uploading) e.currentTarget.style.background = '#5c7a5a';
                }}
              >
                {uploading ? 'Uploading...' : editingId ? 'Update Listing' : 'Post Listing'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div style={{
        maxWidth: '1400px',
        margin: '1.5rem auto',
        padding: '0 2rem 4rem'
      }}>
        {/* Purchases View */}
        {showPurchases ? (
          <div>
            <h2 style={{ color: '#2d2d2d', fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.2rem' }}>
              My Purchases
            </h2>
            {purchases.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '4rem 2rem',
                color: '#9a958e'
              }}>
                <ShoppingBag size={48} style={{ marginBottom: '1rem', opacity: 0.4 }} />
                <p style={{ fontSize: '1rem', margin: 0 }}>No purchases yet.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                {purchases.map(purchase => {
                  const listing = listings.find(l => l.id === purchase.listingId);
                  return (
                    <div key={purchase.id} style={{
                      background: 'white',
                      borderRadius: '14px',
                      border: '1px solid #e0dbd4',
                      padding: '1.2rem',
                      display: 'flex',
                      gap: '1.2rem',
                      alignItems: 'center',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.06)'
                    }}>
                      {listing?.image && (
                        <img src={listing.image} alt={listing?.title || 'Item'} style={{
                          width: '70px',
                          height: '70px',
                          objectFit: 'cover',
                          borderRadius: '10px',
                          flexShrink: 0
                        }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 style={{ color: '#2d2d2d', fontSize: '1rem', fontWeight: '600', margin: '0 0 0.2rem 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {listing?.title || 'Item'}
                        </h3>
                        <p style={{ color: '#5c7a5a', fontSize: '1.1rem', fontWeight: '700', margin: 0 }}>
                          &euro;{purchase.amount?.toFixed(2)}
                        </p>
                      </div>
                      <div style={{ color: '#9a958e', fontSize: '0.85rem', textAlign: 'right', flexShrink: 0 }}>
                        <div>{purchase.createdAt ? formatTimeAgo(purchase.createdAt) : 'Processing'}</div>
                        <div style={{ color: '#5c7a5a', fontWeight: '500', marginTop: '0.2rem' }}>Completed</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : loading ? (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            color: '#9a958e'
          }}>
            <div style={{
              width: '40px',
              height: '40px',
              border: '3px solid #e0dbd4',
              borderTopColor: '#5c7a5a',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 1rem'
            }} />
            <span style={{ fontSize: '1rem' }}>Loading listings...</span>
          </div>
        ) : (
          <>
            {showMyListings && (
              <h2 style={{ color: '#2d2d2d', fontSize: '1.3rem', fontWeight: '600', marginBottom: '1.2rem' }}>
                My Listings
              </h2>
            )}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: '1.5rem'
            }}>
              {filteredListings.map((item, index) => (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  style={{
                    background: 'white',
                    borderRadius: '14px',
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    transition: 'all 0.2s ease',
                    cursor: 'pointer',
                    border: '1px solid #e0dbd4',
                    animation: `fadeInUp 0.4s ease ${index * 0.05}s backwards`
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
                    e.currentTarget.style.borderColor = '#c4956a';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
                    e.currentTarget.style.borderColor = '#e0dbd4';
                  }}
                >
                  <div style={{ position: 'relative' }}>
                    <img
                      src={item.image}
                      alt={item.title}
                      style={{
                        width: '100%',
                        height: '220px',
                        objectFit: 'cover'
                      }}
                    />
                    {item.status === 'sold' && (
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        background: 'rgba(0,0,0,0.45)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <span style={{
                          background: '#c45c5c',
                          color: 'white',
                          padding: '0.5rem 1.5rem',
                          borderRadius: '8px',
                          fontSize: '1rem',
                          fontWeight: '700',
                          letterSpacing: '2px',
                          transform: 'rotate(-8deg)'
                        }}>
                          SOLD
                        </span>
                      </div>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSave(item.id);
                      }}
                      style={{
                        position: 'absolute',
                        top: '0.8rem',
                        right: '0.8rem',
                        background: 'white',
                        border: 'none',
                        borderRadius: '50%',
                        width: '36px',
                        height: '36px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                        transition: 'transform 0.2s'
                      }}
                      onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.1)'}
                      onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    >
                      <Heart
                        size={18}
                        fill={item.saved ? '#c45c5c' : 'none'}
                        color={item.saved ? '#c45c5c' : '#6b6b6b'}
                      />
                    </button>
                    <div style={{
                      position: 'absolute',
                      bottom: '0.8rem',
                      left: '0.8rem',
                      background: '#f5f0eb',
                      color: '#6b6b6b',
                      padding: '0.3rem 0.8rem',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: '500',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem'
                    }}>
                      <Tag size={13} />
                      {item.condition}
                    </div>
                  </div>
                  <div style={{ padding: '1.2rem' }}>
                    <h3 style={{
                      color: '#2d2d2d',
                      fontSize: '1.1rem',
                      fontWeight: '600',
                      marginBottom: '0.3rem',
                      lineHeight: '1.3'
                    }}>
                      {item.title}
                    </h3>
                    <div style={{
                      fontSize: '1.4rem',
                      fontWeight: '700',
                      color: '#5c7a5a',
                      marginBottom: '0.8rem'
                    }}>
                      &euro;{typeof item.price === 'number' ? item.price.toFixed(2) : item.price}
                    </div>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.3rem',
                      fontSize: '0.85rem',
                      color: '#6b6b6b'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <span style={{ fontSize: '0.85rem' }}>Age: {item.age}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <MapPin size={14} />
                        <span>{item.location}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <Clock size={14} />
                        <span>{formatTimeAgo(item.createdAt)}</span>
                      </div>
                    </div>
                    <div style={{
                      marginTop: '0.8rem',
                      paddingTop: '0.8rem',
                      borderTop: '1px solid #f0ece6',
                      fontSize: '0.85rem',
                      color: '#9a958e',
                      fontWeight: '500',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <span>Seller: {displaySellerName(item)}</span>
                      {user && item.sellerId === user.uid && (
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(item);
                            }}
                            style={{
                              background: '#5c7a5a',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              width: '30px',
                              height: '30px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              transition: 'background 0.2s'
                            }}
                            title="Edit listing"
                            onMouseOver={(e) => e.currentTarget.style.background = '#4a6849'}
                            onMouseOut={(e) => e.currentTarget.style.background = '#5c7a5a'}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(item.id);
                            }}
                            style={{
                              background: '#c45c5c',
                              color: 'white',
                              border: 'none',
                              borderRadius: '8px',
                              width: '30px',
                              height: '30px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                              transition: 'background 0.2s'
                            }}
                            title="Delete listing"
                            onMouseOver={(e) => e.currentTarget.style.background = '#a84a4a'}
                            onMouseOut={(e) => e.currentTarget.style.background = '#c45c5c'}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {filteredListings.length === 0 && (
              <div style={{
                textAlign: 'center',
                padding: '4rem 2rem',
                color: '#9a958e'
              }}>
                <Search size={48} style={{ marginBottom: '1rem', opacity: 0.3 }} />
                <p style={{ fontSize: '1rem', margin: 0 }}>
                  {showMyListings ? 'You haven\'t listed any items yet.' : 'No items found. Try a different search or category.'}
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Item Detail Modal */}
      {selectedItem && (
        <div
          onClick={() => setSelectedItem(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 200,
            padding: '2rem',
            animation: 'fadeIn 0.2s ease'
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'white',
              borderRadius: '14px',
              maxWidth: '650px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
              border: '1px solid #e0dbd4',
              animation: 'slideDown 0.3s ease',
              position: 'relative'
            }}
          >
            <button
              onClick={() => setSelectedItem(null)}
              style={{
                position: 'absolute',
                top: '0.8rem',
                right: '0.8rem',
                background: 'white',
                border: 'none',
                borderRadius: '50%',
                width: '36px',
                height: '36px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                zIndex: 10
              }}
            >
              <X size={18} color="#6b6b6b" />
            </button>

            <img
              src={selectedItem.image}
              alt={selectedItem.title}
              style={{
                width: '100%',
                height: '320px',
                objectFit: 'cover',
                borderRadius: '13px 13px 0 0'
              }}
            />

            <div style={{ padding: '1.5rem' }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '0.8rem',
                flexWrap: 'wrap',
                gap: '0.8rem'
              }}>
                <h2 style={{
                  color: '#2d2d2d',
                  fontSize: '1.5rem',
                  fontWeight: '700',
                  margin: 0,
                  lineHeight: '1.3'
                }}>
                  {selectedItem.title}
                </h2>
                <div style={{
                  fontSize: '1.8rem',
                  fontWeight: '700',
                  color: '#5c7a5a',
                  whiteSpace: 'nowrap'
                }}>
                  &euro;{typeof selectedItem.price === 'number' ? selectedItem.price.toFixed(2) : selectedItem.price}
                </div>
              </div>

              <div style={{
                display: 'flex',
                gap: '0.5rem',
                flexWrap: 'wrap',
                marginBottom: '1.2rem'
              }}>
                <span style={{
                  background: '#5c7a5a',
                  color: 'white',
                  padding: '0.3rem 0.8rem',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: '500',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem'
                }}>
                  <Tag size={13} />
                  {selectedItem.condition}
                </span>
                <span style={{
                  background: '#f5f0eb',
                  color: '#6b6b6b',
                  padding: '0.3rem 0.8rem',
                  borderRadius: '8px',
                  fontSize: '0.8rem',
                  fontWeight: '500'
                }}>
                  {selectedItem.category?.charAt(0).toUpperCase() + selectedItem.category?.slice(1)}
                </span>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '0.8rem',
                marginBottom: '1.2rem'
              }}>
                <div style={{
                  background: '#f5f0eb',
                  padding: '0.8rem',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem'
                }}>
                  <span style={{ fontSize: '1rem', color: '#6b6b6b' }}>Age</span>
                  <div style={{ color: '#2d2d2d', fontWeight: '600', fontSize: '0.9rem' }}>{selectedItem.age}</div>
                </div>
                <div style={{
                  background: '#f5f0eb',
                  padding: '0.8rem',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem'
                }}>
                  <MapPin size={16} color="#6b6b6b" />
                  <div style={{ color: '#2d2d2d', fontWeight: '600', fontSize: '0.9rem' }}>{selectedItem.location}</div>
                </div>
                <div style={{
                  background: '#f5f0eb',
                  padding: '0.8rem',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem'
                }}>
                  <Clock size={16} color="#6b6b6b" />
                  <div style={{ color: '#2d2d2d', fontWeight: '600', fontSize: '0.9rem' }}>{formatTimeAgo(selectedItem.createdAt)}</div>
                </div>
                <div style={{
                  background: '#f5f0eb',
                  padding: '0.8rem',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.6rem'
                }}>
                  <User size={16} color="#6b6b6b" />
                  <div style={{ color: '#2d2d2d', fontWeight: '600', fontSize: '0.9rem' }}>{displaySellerName(selectedItem)}</div>
                </div>
              </div>

              {selectedItem.description && (
                <div style={{ marginBottom: '1.2rem' }}>
                  <h3 style={{ color: '#2d2d2d', fontSize: '0.95rem', fontWeight: '600', marginBottom: '0.4rem' }}>
                    Description
                  </h3>
                  <p style={{
                    color: '#6b6b6b',
                    fontSize: '0.9rem',
                    lineHeight: '1.6',
                    margin: 0
                  }}>
                    {selectedItem.description}
                  </p>
                </div>
              )}

              {/* Buy Now Button */}
              {user && selectedItem.sellerId !== user.uid && selectedItem.status !== 'sold' && (
                <div style={{
                  borderTop: '1px solid #f0ece6',
                  paddingTop: '1.2rem',
                  marginTop: '0.5rem'
                }}>
                  <button
                    onClick={() => handleBuyNow(selectedItem)}
                    disabled={buyLoading}
                    style={{
                      width: '100%',
                      background: buyLoading ? '#9a958e' : '#5c7a5a',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '1rem',
                      fontSize: '1.1rem',
                      fontWeight: '600',
                      cursor: buyLoading ? 'not-allowed' : 'pointer',
                      transition: 'background 0.2s',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem'
                    }}
                    onMouseOver={(e) => {
                      if (!buyLoading) e.currentTarget.style.background = '#4a6849';
                    }}
                    onMouseOut={(e) => {
                      if (!buyLoading) e.currentTarget.style.background = '#5c7a5a';
                    }}
                  >
                    {buyLoading ? 'Preparing checkout...' : 'Buy Now'}
                  </button>
                </div>
              )}

              {/* Sold Badge */}
              {selectedItem.status === 'sold' && (
                <div style={{
                  borderTop: '1px solid #f0ece6',
                  paddingTop: '1.2rem',
                  marginTop: '0.5rem',
                  textAlign: 'center'
                }}>
                  <div style={{
                    background: '#f5f0eb',
                    color: '#9a958e',
                    padding: '0.8rem',
                    borderRadius: '10px',
                    fontSize: '1rem',
                    fontWeight: '600'
                  }}>
                    This item has been sold
                  </div>
                </div>
              )}

              {/* Owner Actions */}
              {user && selectedItem.sellerId === user.uid && selectedItem.status !== 'sold' && (
                <div style={{
                  display: 'flex',
                  gap: '0.8rem',
                  borderTop: '1px solid #f0ece6',
                  paddingTop: '1.2rem',
                  marginTop: '0.5rem'
                }}>
                  <button
                    onClick={() => {
                      handleEdit(selectedItem);
                      setSelectedItem(null);
                    }}
                    style={{
                      flex: 1,
                      background: '#5c7a5a',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '0.8rem',
                      fontSize: '0.95rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem',
                      transition: 'background 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#4a6849'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#5c7a5a'}
                  >
                    <Edit2 size={16} />
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      handleDelete(selectedItem.id);
                      setSelectedItem(null);
                    }}
                    style={{
                      flex: 1,
                      background: '#c45c5c',
                      color: 'white',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '0.8rem',
                      fontSize: '0.95rem',
                      fontWeight: '600',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem',
                      transition: 'background 0.2s'
                    }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#a84a4a'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#c45c5c'}
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');

        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(15px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-15px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        * {
          box-sizing: border-box;
        }

        input, select, textarea, button {
          font-family: inherit;
        }
      `}</style>
    </div>
  );
};

export default KidsMarketplace;
