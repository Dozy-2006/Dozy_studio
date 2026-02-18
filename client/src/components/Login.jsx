import React, { useState } from 'react';
import axios from 'axios';

export default function LoginPage({ onLogin }) {
  const [role, setRole] = useState('User');
  const [tagNumber, setTagNumber] = useState('');
  const [authKey, setAuthKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Handle Form Submission (Works on Click OR Enter Key)
  const handleSubmit = async (e) => {
    e.preventDefault(); // Prevents page reload
    setError('');
    setLoading(true);

    if (!tagNumber || !authKey) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    try {
      // Call Backend API
      const res = await axios.post('http://localhost:5000/api/login', {
        role,
        tagNumber,
        authKey
      });

      if (res.data.success) {
        // Pass user data up to App.js to switch screens
        onLogin(res.data.user);
      }
    } catch (err) {
      // Handle Errors (Invalid Code, User Not Found, Server Error)
      setError(err.response?.data?.message || 'Login Failed. Check connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md border-t-4 border-indigo-600">

        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800">Police Portal Login</h1>
          <p className="text-gray-500 text-sm">Secure Access Gateway</p>
        </div>

        {/* Wrapping inputs in a <form> tag makes the "Enter" key 
            automatically trigger the onSubmit function.
        */}
        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Role Selection */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Select Role</label>
            <div className="flex bg-gray-100 p-1 rounded border">
              {['User', 'Manager', 'Admin'].map((r) => (
                <button
                  key={r}
                  type="button" // Important: type="button" prevents this from submitting the form
                  onClick={() => setRole(r)}
                  className={`flex-1 py-2 text-sm font-bold rounded transition-all ${role === r
                    ? 'bg-white text-indigo-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                    }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Tag Number Input (or Name for Admin) */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">
              {role === 'Admin' ? 'Name' : 'Tag Number'}
            </label>
            <input
              type="text"
              placeholder={role === 'Admin' ? 'Enter your name' : 'Enter your Tag Number'}
              value={tagNumber}
              onChange={(e) => setTagNumber(e.target.value)}
              className="w-full border border-gray-300 p-3 rounded focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
            />
          </div>

          {/* Auth Key (TOTP) Input */}
          <div>
            <label className="block text-sm font-bold text-gray-700 mb-1">Authenticator Code</label>
            <input
              type="text" // Use "text" or "number" depending on preference
              inputMode="numeric"
              placeholder="Enter 6-digit code"
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
              className="w-full border border-gray-300 p-3 rounded font-mono  tracking-widest text-lg focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
              maxLength={6}
            />
          </div>

          {/* Error Message Display */}
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded text-sm text-center border border-red-200 animate-pulse">
              ⚠️ {error}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit" // Triggers onSubmit
            disabled={loading}
            className={`w-full py-3 rounded text-white font-bold shadow-md transition-all ${loading
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-indigo-600 hover:bg-indigo-700 hover:scale-[1.02]'
              }`}
          >
            {loading ? 'Verifying...' : 'Access Portal'}
          </button>

        </form>
      </div>
    </div>
  );
}