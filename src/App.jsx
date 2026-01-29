import React, { useState, useEffect } from 'react';
import { Search, Plus, Tag, Heart, MapPin, Clock, LogOut, User, Upload, X, Edit2, Trash2 } from 'lucide-react';
import { auth, db, storage } from './firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged 
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  onSnapshot,
  deleteDoc,
  doc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const KidsMarketplace = () => {
  const [user, setUser] = useState(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Form state
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

  const categories = [
    { id: 'all', label: 'All Items', icon: '🎪' },
    { id: 'toys', label: 'Toys', icon: '🧸' },
    { id: 'clothes', label: 'Clothes', icon: '👕' },
    { id: 'accessories', label: 'Accessories', icon: '🎒' }
  ];

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

  // Auth functions
  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      setShowAuthModal(false);
      setEmail('');
      setPassword('');
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const handleGoogleAuth = async () => {
    setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setShowAuthModal(false);
    } catch (error) {
      setAuthError(error.message);
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

      // Reset form
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

  const filteredListings = listings.filter(item => {
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

  // Auth Modal
  if (showAuthModal) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #fef5e7 0%, #fdecd1 50%, #fce5cd 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        fontFamily: '"Fredoka", "Comic Neue", sans-serif'
      }}>
        <div style={{
          background: 'white',
          borderRadius: '30px',
          padding: '3rem',
          maxWidth: '450px',
          width: '100%',
          boxShadow: '0 20px 60px rgba(255, 107, 157, 0.3)',
          border: '4px solid #ffa06b'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🎠</div>
            <h1 style={{
              color: '#ff6b9d',
              fontSize: '2rem',
              fontWeight: '700',
              marginBottom: '0.5rem'
            }}>
              Welcome to Little Treasures
            </h1>
            <p style={{ color: '#666', fontSize: '1.1rem' }}>
              {isLogin ? 'Sign in to your account' : 'Create your account'}
            </p>
          </div>

          {authError && (
            <div style={{
              background: '#ffe5e5',
              color: '#cc0000',
              padding: '1rem',
              borderRadius: '10px',
              marginBottom: '1rem',
              fontSize: '0.9rem'
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
                padding: '1rem',
                marginBottom: '1rem',
                fontSize: '1rem',
                border: '3px solid #ffd4e5',
                borderRadius: '15px',
                outline: 'none',
                fontFamily: 'inherit'
              }}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '1rem',
                marginBottom: '1.5rem',
                fontSize: '1rem',
                border: '3px solid #ffd4e5',
                borderRadius: '15px',
                outline: 'none',
                fontFamily: 'inherit'
              }}
            />
            <button
              type="submit"
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, #ff6b9d 0%, #ffa06b 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '50px',
                padding: '1.2rem',
                fontSize: '1.1rem',
                fontWeight: '600',
                cursor: 'pointer',
                boxShadow: '0 6px 20px rgba(255, 107, 157, 0.3)',
                fontFamily: 'inherit',
                transition: 'transform 0.2s'
              }}
              onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
              onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
            >
              {isLogin ? '🔑 Sign In' : '✨ Create Account'}
            </button>
          </form>

          <div style={{
            textAlign: 'center',
            color: '#999',
            marginBottom: '1rem',
            fontSize: '0.9rem'
          }}>
            OR
          </div>

          <button
            onClick={handleGoogleAuth}
            style={{
              width: '100%',
              background: 'white',
              color: '#333',
              border: '3px solid #ffd4e5',
              borderRadius: '50px',
              padding: '1.2rem',
              fontSize: '1.1rem',
              fontWeight: '600',
              cursor: 'pointer',
              fontFamily: 'inherit',
              marginBottom: '1.5rem',
              transition: 'all 0.2s'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = '#ff6b9d';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = '#ffd4e5';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            🔍 Continue with Google
          </button>

          <div style={{ textAlign: 'center', fontSize: '0.95rem', color: '#666' }}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <button
              onClick={() => {
                setIsLogin(!isLogin);
                setAuthError('');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#ff6b9d',
                fontWeight: '600',
                cursor: 'pointer',
                textDecoration: 'underline',
                fontFamily: 'inherit',
                fontSize: '0.95rem'
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
      background: 'linear-gradient(135deg, #fef5e7 0%, #fdecd1 50%, #fce5cd 100%)',
      fontFamily: '"Fredoka", "Comic Neue", sans-serif'
    }}>
      {/* Header */}
      <header style={{
        background: 'linear-gradient(135deg, #ff6b9d 0%, #ffa06b 100%)',
        padding: '2rem',
        boxShadow: '0 8px 32px rgba(255, 107, 157, 0.3)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        borderBottom: '4px solid #ff8fb0'
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div style={{
                fontSize: '3rem',
                animation: 'bounce 2s infinite',
                filter: 'drop-shadow(2px 2px 4px rgba(0,0,0,0.2))'
              }}>🎠</div>
              <h1 style={{
                color: 'white',
                fontSize: '2.5rem',
                fontWeight: '700',
                margin: 0,
                textShadow: '3px 3px 0px rgba(0,0,0,0.1)',
                letterSpacing: '1px'
              }}>
                Little Treasures
              </h1>
            </div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{
                background: 'rgba(255,255,255,0.2)',
                padding: '0.8rem 1.5rem',
                borderRadius: '50px',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <User size={18} />
                <span style={{ fontSize: '0.95rem' }}>{user?.email}</span>
              </div>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                style={{
                  background: 'white',
                  color: '#ff6b9d',
                  border: 'none',
                  borderRadius: '50px',
                  padding: '1rem 2rem',
                  fontSize: '1.1rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
                  transition: 'all 0.3s ease',
                  fontFamily: 'inherit'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-3px) scale(1.05)';
                  e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0) scale(1)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.15)';
                }}
              >
                <Plus size={20} />
                Sell Item
              </button>
              <button
                onClick={handleLogout}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  color: 'white',
                  border: '2px solid white',
                  borderRadius: '50%',
                  width: '50px',
                  height: '50px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.background = 'white';
                  e.currentTarget.style.color = '#ff6b9d';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.2)';
                  e.currentTarget.style.color = 'white';
                }}
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>

          {/* Search Bar */}
          <div style={{ position: 'relative' }}>
            <Search 
              size={22} 
              style={{
                position: 'absolute',
                left: '1.5rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#ff6b9d',
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
                padding: '1.2rem 1.5rem 1.2rem 4rem',
                fontSize: '1.1rem',
                border: 'none',
                borderRadius: '50px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                outline: 'none',
                fontFamily: 'inherit',
                background: 'white'
              }}
            />
          </div>
        </div>
      </header>

      {/* Category Pills */}
      <div style={{
        maxWidth: '1400px',
        margin: '2rem auto',
        padding: '0 2rem'
      }}>
        <div style={{
          display: 'flex',
          gap: '1rem',
          flexWrap: 'wrap',
          justifyContent: 'center'
        }}>
          {categories.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              style={{
                background: selectedCategory === cat.id 
                  ? 'linear-gradient(135deg, #ff6b9d 0%, #ffa06b 100%)'
                  : 'white',
                color: selectedCategory === cat.id ? 'white' : '#ff6b9d',
                border: selectedCategory === cat.id ? 'none' : '3px solid #ff6b9d',
                borderRadius: '50px',
                padding: '1rem 2rem',
                fontSize: '1.1rem',
                fontWeight: '600',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                transition: 'all 0.3s ease',
                boxShadow: selectedCategory === cat.id 
                  ? '0 6px 20px rgba(255, 107, 157, 0.3)'
                  : '0 4px 12px rgba(0,0,0,0.1)',
                fontFamily: 'inherit'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-3px) scale(1.05)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0) scale(1)';
              }}
            >
              <span style={{ fontSize: '1.5rem' }}>{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Add/Edit Listing Form */}
      {showAddForm && (
        <div style={{
          maxWidth: '800px',
          margin: '2rem auto',
          padding: '0 2rem'
        }}>
          <div style={{
            background: 'white',
            borderRadius: '30px',
            padding: '2.5rem',
            boxShadow: '0 12px 40px rgba(255, 107, 157, 0.2)',
            border: '4px solid #ffa06b',
            animation: 'slideDown 0.4s ease',
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
                top: '1.5rem',
                right: '1.5rem',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#999',
                padding: '0.5rem'
              }}
            >
              <X size={24} />
            </button>
            <h2 style={{
              color: '#ff6b9d',
              fontSize: '2rem',
              fontWeight: '700',
              marginBottom: '1.5rem',
              textAlign: 'center'
            }}>
              {editingId ? '✏️ Edit Your Item' : '✨ List Your Item'}
            </h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              {/* Image Upload */}
              <div>
                <label style={{ display: 'block', color: '#ff6b9d', fontWeight: '600', marginBottom: '0.5rem' }}>
                  Product Photo
                </label>
                <div style={{
                  border: '3px dashed #ffd4e5',
                  borderRadius: '15px',
                  padding: '2rem',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.3s'
                }}
                onMouseOver={(e) => e.currentTarget.style.borderColor = '#ff6b9d'}
                onMouseOut={(e) => e.currentTarget.style.borderColor = '#ffd4e5'}
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
                        maxHeight: '200px',
                        borderRadius: '10px'
                      }} />
                    ) : (
                      <div>
                        <Upload size={48} color="#ff6b9d" style={{ marginBottom: '1rem' }} />
                        <p style={{ color: '#ff6b9d', fontWeight: '600' }}>
                          Click to upload image
                        </p>
                        <p style={{ color: '#999', fontSize: '0.9rem' }}>
                          JPG, PNG, or GIF (max 5MB)
                        </p>
                      </div>
                    )}
                  </label>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', color: '#ff6b9d', fontWeight: '600', marginBottom: '0.5rem' }}>
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
                    padding: '1rem',
                    fontSize: '1rem',
                    border: '3px solid #ffd4e5',
                    borderRadius: '15px',
                    outline: 'none',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', color: '#ff6b9d', fontWeight: '600', marginBottom: '0.5rem' }}>
                    Price ($) *
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
                      padding: '1rem',
                      fontSize: '1rem',
                      border: '3px solid #ffd4e5',
                      borderRadius: '15px',
                      outline: 'none',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', color: '#ff6b9d', fontWeight: '600', marginBottom: '0.5rem' }}>
                    Category *
                  </label>
                  <select 
                    name="category"
                    value={formData.category}
                    onChange={handleInputChange}
                    style={{
                      width: '100%',
                      padding: '1rem',
                      fontSize: '1rem',
                      border: '3px solid #ffd4e5',
                      borderRadius: '15px',
                      outline: 'none',
                      fontFamily: 'inherit'
                    }}
                  >
                    <option value="toys">Toys</option>
                    <option value="clothes">Clothes</option>
                    <option value="accessories">Accessories</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div>
                  <label style={{ display: 'block', color: '#ff6b9d', fontWeight: '600', marginBottom: '0.5rem' }}>
                    Condition *
                  </label>
                  <select
                    name="condition"
                    value={formData.condition}
                    onChange={handleInputChange}
                    style={{
                      width: '100%',
                      padding: '1rem',
                      fontSize: '1rem',
                      border: '3px solid #ffd4e5',
                      borderRadius: '15px',
                      outline: 'none',
                      fontFamily: 'inherit'
                    }}
                  >
                    <option>Like New</option>
                    <option>Excellent</option>
                    <option>Good</option>
                    <option>Fair</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', color: '#ff6b9d', fontWeight: '600', marginBottom: '0.5rem' }}>
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
                      padding: '1rem',
                      fontSize: '1rem',
                      border: '3px solid #ffd4e5',
                      borderRadius: '15px',
                      outline: 'none',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>
              </div>
              <div>
                <label style={{ display: 'block', color: '#ff6b9d', fontWeight: '600', marginBottom: '0.5rem' }}>
                  Location *
                </label>
                <input
                  type="text"
                  name="location"
                  value={formData.location}
                  onChange={handleInputChange}
                  placeholder="City, State"
                  required
                  style={{
                    width: '100%',
                    padding: '1rem',
                    fontSize: '1rem',
                    border: '3px solid #ffd4e5',
                    borderRadius: '15px',
                    outline: 'none',
                    fontFamily: 'inherit'
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', color: '#ff6b9d', fontWeight: '600', marginBottom: '0.5rem' }}>
                  Description
                </label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  placeholder="Tell us about your item..."
                  rows="4"
                  style={{
                    width: '100%',
                    padding: '1rem',
                    fontSize: '1rem',
                    border: '3px solid #ffd4e5',
                    borderRadius: '15px',
                    outline: 'none',
                    fontFamily: 'inherit',
                    resize: 'vertical'
                  }}
                />
              </div>
              <button
                type="submit"
                disabled={uploading}
                style={{
                  background: uploading 
                    ? '#ccc' 
                    : 'linear-gradient(135deg, #ff6b9d 0%, #ffa06b 100%)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '50px',
                  padding: '1.2rem 2rem',
                  fontSize: '1.2rem',
                  fontWeight: '600',
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  boxShadow: '0 6px 20px rgba(255, 107, 157, 0.3)',
                  transition: 'all 0.3s ease',
                  fontFamily: 'inherit'
                }}
                onMouseOver={(e) => {
                  if (!uploading) {
                    e.currentTarget.style.transform = 'translateY(-3px)';
                    e.currentTarget.style.boxShadow = '0 10px 30px rgba(255, 107, 157, 0.4)';
                  }
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 6px 20px rgba(255, 107, 157, 0.3)';
                }}
              >
                {uploading ? '⏳ Uploading...' : editingId ? '💾 Update Listing' : '🎉 Post Listing'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Listings Grid */}
      <div style={{
        maxWidth: '1400px',
        margin: '2rem auto',
        padding: '0 2rem 4rem'
      }}>
        {loading ? (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            color: '#ff6b9d',
            fontSize: '1.5rem',
            fontWeight: '600'
          }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem', animation: 'bounce 1s infinite' }}>🎠</div>
            Loading listings...
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '2rem'
          }}>
            {filteredListings.map((item, index) => (
              <div
                key={item.id}
                style={{
                  background: 'white',
                  borderRadius: '25px',
                  overflow: 'hidden',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer',
                  border: '3px solid transparent',
                  animation: `fadeInUp 0.5s ease ${index * 0.1}s backwards`
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.transform = 'translateY(-10px)';
                  e.currentTarget.style.boxShadow = '0 16px 40px rgba(255, 107, 157, 0.3)';
                  e.currentTarget.style.borderColor = '#ffa06b';
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.1)';
                  e.currentTarget.style.borderColor = 'transparent';
                }}
              >
                <div style={{ position: 'relative' }}>
                  <img
                    src={item.image}
                    alt={item.title}
                    style={{
                      width: '100%',
                      height: '250px',
                      objectFit: 'cover'
                    }}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSave(item.id);
                    }}
                    style={{
                      position: 'absolute',
                      top: '1rem',
                      right: '1rem',
                      background: 'white',
                      border: 'none',
                      borderRadius: '50%',
                      width: '45px',
                      height: '45px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                      transition: 'all 0.3s ease'
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.transform = 'scale(1.1)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                    }}
                  >
                    <Heart
                      size={22}
                      fill={item.saved ? '#ff6b9d' : 'none'}
                      color={item.saved ? '#ff6b9d' : '#666'}
                    />
                  </button>
                  <div style={{
                    position: 'absolute',
                    bottom: '1rem',
                    left: '1rem',
                    background: 'linear-gradient(135deg, #ff6b9d 0%, #ffa06b 100%)',
                    color: 'white',
                    padding: '0.5rem 1rem',
                    borderRadius: '20px',
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.3rem'
                  }}>
                    <Tag size={16} />
                    {item.condition}
                  </div>
                </div>
                <div style={{ padding: '1.5rem' }}>
                  <h3 style={{
                    color: '#333',
                    fontSize: '1.3rem',
                    fontWeight: '700',
                    marginBottom: '0.5rem',
                    lineHeight: '1.3'
                  }}>
                    {item.title}
                  </h3>
                  <div style={{
                    fontSize: '2rem',
                    fontWeight: '800',
                    color: '#ff6b9d',
                    marginBottom: '1rem'
                  }}>
                    ${typeof item.price === 'number' ? item.price.toFixed(2) : item.price}
                  </div>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem',
                    fontSize: '0.95rem',
                    color: '#666'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span>👶</span>
                      <span>{item.age}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <MapPin size={16} />
                      <span>{item.location}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Clock size={16} />
                      <span>{formatTimeAgo(item.createdAt)}</span>
                    </div>
                  </div>
                  <div style={{
                    marginTop: '1rem',
                    paddingTop: '1rem',
                    borderTop: '2px solid #f0f0f0',
                    fontSize: '0.9rem',
                    color: '#999',
                    fontWeight: '600',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <span>Seller: {item.seller?.split('@')[0]}</span>
                    {user && item.sellerId === user.uid && (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(item);
                          }}
                          style={{
                            background: '#4CAF50',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '35px',
                            height: '35px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                          title="Edit listing"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(item.id);
                          }}
                          style={{
                            background: '#f44336',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '35px',
                            height: '35px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                          title="Delete listing"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filteredListings.length === 0 && (
          <div style={{
            textAlign: 'center',
            padding: '4rem 2rem',
            color: '#ff6b9d',
            fontSize: '1.5rem',
            fontWeight: '600'
          }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🔍</div>
            No items found. Try a different search or category!
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&display=swap');
        
        @keyframes bounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        * {
          box-sizing: border-box;
        }
      `}</style>
    </div>
  );
};

export default KidsMarketplace;
