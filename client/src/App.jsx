import React, { useState } from 'react';

// Make sure your files are in the 'components' folder, 
// or change these paths to './Login', './AdminPanel', etc.
import Login from './components/Login';         
import AdminPanel from './components/AdminPanel';
import ManagerPanel from './components/ManagerPanel';
import UserPanel from './components/UserPanel';

function App() {
  // State to store the logged-in user object
  const [user, setUser] = useState(null);

  // 1. If no user is logged in, show the Login Screen
  if (!user) {
    return <Login onLogin={setUser} />;
  }

  // 2. If logged in, show the Dashboard based on Role
  return (
    <div className="min-h-screen bg-gray-50">
      
      {/* Navbar */}
      <nav className="bg-white shadow p-4 mb-6 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center gap-3">
            {/* You can add a logo here if you want */}
            <div className="bg-indigo-600 text-white p-2 rounded font-bold">PP</div>
            <h1 className="text-xl font-bold text-gray-800">Police Portal</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
              <p className="text-gray-800 font-bold text-sm">{user.name}</p>
              <span className={`text-xs px-2 py-0.5 rounded font-bold ${
                  user.role === 'Admin' ? 'bg-purple-100 text-purple-700' :
                  user.role === 'Manager' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-200 text-gray-700'
              }`}>
                {user.role}
              </span>
          </div>
          
          <button 
            onClick={() => setUser(null)} 
            className="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded text-sm font-bold shadow transition-transform transform active:scale-95"
          >
            Logout
          </button>
        </div>
      </nav>

      {/* Main Content Panels */}
      <div className="container mx-auto px-4 pb-10">
        {user.role === 'Admin' && <AdminPanel />}
        {user.role === 'Manager' && <ManagerPanel currentUser={user} />}
        {user.role === 'User' && <UserPanel currentUser={user} />}
      </div>
    </div>
  );
}

export default App;