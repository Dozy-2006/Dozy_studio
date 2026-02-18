import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';

export default function AdminPanel() {
  const [currentView, setCurrentView] = useState('dashboard');

  return (
    <div className="min-h-screen bg-gray-50 font-sans">
      {currentView === 'dashboard' && <DashboardView onNavigate={setCurrentView} />}
      {currentView === 'users' && <ManageUsersPage onBack={() => setCurrentView('dashboard')} />}
      {currentView === 'divisions' && <ManageDivisionsPage onBack={() => setCurrentView('dashboard')} />}
      {currentView === 'groups' && <ManageGroupsPage onBack={() => setCurrentView('dashboard')} />}
    </div>
  );
}

// ==========================================
// 1. DASHBOARD VIEW
// ==========================================
function DashboardView({ onNavigate }) {
  const [formData, setFormData] = useState({ name: '', phone: '', tagNumber: '', role: 'User', subdivision: '', station: '', emails: [''] });
  const [qrCode, setQrCode] = useState(null);
  const [manualKey, setManualKey] = useState(null);
  const [structure, setStructure] = useState({});
  const [loading, setLoading] = useState(false);
  const [resetEmail, setResetEmail] = useState('');

  // Fetch structure on mount and poll every 5 seconds
  useEffect(() => {
    fetchStructure();
    const interval = setInterval(fetchStructure, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchStructure = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/admin/structure');
      setStructure(res.data || {});
    } catch (err) { console.error(err); }
  };

  const createUser = async () => {
    // 1. Basic empty check - validate at least one email
    const validEmails = formData.emails.filter(e => e.trim() !== '');
    if (!formData.name || validEmails.length === 0 || !formData.phone) {
      return alert("Please fill Name, Phone, and at least one Email");
    }

    // 2. Phone Number Validation
    const phoneRegex = /^\d{10}$/;
    if (!phoneRegex.test(formData.phone)) {
      return alert("⚠️ Invalid Phone Number: Must be exactly 10 digits.");
    }

    // 2.5. Check for Duplicate Emails
    const emailSet = new Set(validEmails.map(e => e.toLowerCase().trim()));
    if (emailSet.size !== validEmails.length) {
      return alert("⚠️ Duplicate emails detected! Each email must be unique.");
    }


    // 3. Tag Number Validation for Users and Managers only (Admins use name)
    if ((formData.role === 'User' || formData.role === 'Manager') && !formData.tagNumber) {
      return alert("Tag Number is required for Users and Managers");
    }

    // 4. Role-Specific Logic & Structure Validation
    let finalSubdivision = formData.subdivision;
    let finalStation = formData.station;

    if (formData.role !== 'Admin') {
      if (!formData.subdivision) return alert("Subdivision is required");

      // Validate Subdivision (Case-Insensitive)
      const validSubs = Object.keys(structure);
      const matchedSub = validSubs.find(s => s.toLowerCase() === formData.subdivision.trim().toLowerCase());

      if (!matchedSub) {
        return alert(`❌ Invalid Subdivision '${formData.subdivision}'.\n\nAvailable Subdivisions:\n${validSubs.join(', ')}`);
      }
      finalSubdivision = matchedSub; // Use correct casing from DB

      if (formData.role === 'User') {
        if (!formData.station) return alert("Station is required for User");

        // Validate Station (Case-Insensitive)
        const validStations = structure[matchedSub] || [];
        const matchedStation = validStations.find(s => s.toLowerCase() === formData.station.trim().toLowerCase());

        if (!matchedStation) {
          return alert(`❌ Invalid Station '${formData.station}' for ${matchedSub}.\n\nAvailable Stations:\n${validStations.join(', ')}`);
        }
        finalStation = matchedStation; // Use correct casing from DB
      } else if (formData.role === 'Manager') {
        // For Managers, just require that they entered a role name
        if (!formData.station) return alert("Role Name is required for Manager");
        finalStation = formData.station.trim(); // Use as-is, no validation against structure
      }
    }

    setLoading(true);
    setQrCode(null);
    setManualKey(null);

    // Prepare payload with corrected casing and cleaned emails array
    const payload = { ...formData, emails: validEmails, subdivision: finalSubdivision, station: finalStation };

    try {
      const res = await axios.post('http://localhost:5000/api/admin/create-user', payload);
      setQrCode(res.data.qrCode);
      setManualKey(res.data.secret);
      setResetEmail(validEmails[0]); // Use first email for reset
      alert('User Created Successfully! Please scan the QR code.');
      // Reset form
      setFormData({ name: '', phone: '', tagNumber: '', role: 'User', subdivision: '', station: '', emails: [''] });
    } catch (err) {
      alert(err.response?.data?.message || 'Error creating user');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!resetEmail) return alert("Enter email");
    try {
      const res = await axios.post('http://localhost:5000/api/admin/reset-key', { email: resetEmail });
      setQrCode(res.data.qrCode);
      setManualKey(res.data.secret);
      alert('Key Reset! Scan the new QR Code.');
    } catch (err) { alert('Error resetting key. Ensure user exists.'); }
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 tracking-tight">Admin Dashboard</h1>
          <p className="text-gray-500 mt-1">System Overview & Registration</p>
        </div>
        <div className="flex gap-4 mt-4 md:mt-0">
          <button onClick={() => onNavigate('divisions')} className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg shadow font-bold hover:bg-indigo-700 transition-all hover:-translate-y-0.5">
            🏢 Manage Stations
          </button>
          <button onClick={() => onNavigate('users')} className="bg-gray-800 text-white px-6 py-2.5 rounded-lg shadow font-bold hover:bg-gray-900 transition-all hover:-translate-y-0.5">
            👥 Manage Users
          </button>
          <button onClick={() => onNavigate('groups')} className="bg-purple-600 text-white px-6 py-2.5 rounded-lg shadow font-bold hover:bg-purple-700 transition-all hover:-translate-y-0.5">
            👥 Manage Groups
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Create User Form */}
        <div className="w-full lg:w-1/2 space-y-6">
          <div className="bg-white p-8 rounded-xl shadow-md border-t-4 border-green-500">
            <h2 className="text-xl font-bold mb-6 text-gray-800 flex items-center gap-2">
              <span className="bg-green-100 text-green-600 p-1 rounded">👤</span> Register New Unit
            </h2>
            <div className="space-y-4">
              <input placeholder="Full Name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full border p-3 rounded-lg bg-gray-50 focus:ring-2 focus:ring-green-500 outline-none transition-all" />

              <input
                type="text"
                placeholder="Phone Number (10 digits)"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                className="w-full border p-3 rounded-lg bg-gray-50 focus:ring-2 focus:ring-green-500 outline-none transition-all"
              />

              {/* Multiple Email Inputs */}
              <div className="space-y-2">
                {formData.emails.map((email, index) => (
                  <div key={index} className="flex gap-2 items-center">
                    <input
                      placeholder={`Email ${index + 1} (Google ID)`}
                      value={email}
                      onChange={e => {
                        const newEmails = [...formData.emails];
                        newEmails[index] = e.target.value;
                        setFormData({ ...formData, emails: newEmails });
                      }}
                      className="flex-1 border p-3 rounded-lg bg-gray-50 focus:ring-2 focus:ring-green-500 outline-none transition-all"
                    />
                    {formData.emails.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          const newEmails = formData.emails.filter((_, i) => i !== index);
                          setFormData({ ...formData, emails: newEmails });
                        }}
                        className="bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition-colors shadow-sm hover:shadow-md"
                        title="Remove email"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                      </button>
                    )}
                    {index === formData.emails.length - 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setFormData({ ...formData, emails: [...formData.emails, ''] });
                        }}
                        className="bg-green-500 text-white p-2 rounded-lg hover:bg-green-600 transition-colors shadow-sm hover:shadow-md"
                        title="Add another email"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
                <p className="text-xs text-gray-500 ml-1">Click + to add more email addresses (no limit)</p>
              </div>

              <select value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value, subdivision: '', station: '', emails: [''] })} className="w-full border p-3 rounded-lg bg-white font-bold text-gray-700 focus:ring-2 focus:ring-green-500">
                <option value="User">User</option>
                <option value="Manager">Manager</option>
                <option value="Admin">Admin</option>
              </select>

              {/* Tag Number Input (For Users and Managers only, not Admins) */}
              {(formData.role === 'User' || formData.role === 'Manager') && (
                <div className="animate-fade-in">
                  <input
                    placeholder="Tag Number / Badge No."
                    value={formData.tagNumber}
                    onChange={e => setFormData({ ...formData, tagNumber: e.target.value })}
                    className="w-full border p-3 rounded-lg bg-yellow-50 border-yellow-200 focus:ring-2 focus:ring-yellow-500 outline-none transition-all font-mono font-bold"
                  />
                </div>
              )}

              {/* UPDATED: Text Inputs instead of Selects */}
              {formData.role !== 'Admin' && (
                <div className="grid grid-cols-1 gap-4 animate-fade-in">

                  {/* Subdivision Input */}
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Subdivision Name"
                      value={formData.subdivision}
                      onChange={e => setFormData({ ...formData, subdivision: e.target.value })}
                      className="w-full border p-3 rounded-lg bg-white focus:ring-2 focus:ring-green-500 outline-none"
                    />
                    <p className="text-[10px] text-gray-400 mt-1 ml-1">Must match an existing subdivision.</p>
                  </div>

                  {/* Role Name Input for Managers, Station Input for Users */}
                  {formData.role === 'Manager' ? (
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Role Name"
                        value={formData.station}
                        onChange={e => setFormData({ ...formData, station: e.target.value })}
                        className="w-full border p-3 rounded-lg bg-blue-50 border-blue-200 focus:ring-2 focus:ring-blue-500 outline-none"
                      />
                      <p className="text-[10px] text-gray-400 mt-1 ml-1">Enter the manager's role or designation.</p>
                    </div>
                  ) : formData.role === 'User' && (
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Station Name"
                        value={formData.station}
                        onChange={e => setFormData({ ...formData, station: e.target.value })}
                        disabled={!formData.subdivision}
                        className={`w-full border p-3 rounded-lg focus:ring-2 focus:ring-green-500 outline-none ${!formData.subdivision ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'}`}
                      />
                      <p className="text-[10px] text-gray-400 mt-1 ml-1">Must be a valid station under the chosen subdivision.</p>
                    </div>
                  )}
                </div>
              )}

              <button onClick={createUser} disabled={loading} className={`w-full text-white font-bold py-3.5 rounded-lg transition-all shadow-md ${loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 hover:shadow-lg'}`}>
                {loading ? 'Processing...' : 'Create User & Generate 2FA'}
              </button>
            </div>
          </div>



          {qrCode && (
            <div className="bg-blue-50 border-blue-200 border rounded-xl p-6 text-center animate-fade-in-up">
              <p className="font-bold text-lg text-blue-900 mb-1">Scan with Authenticator App</p>
              <div className="bg-white p-2 inline-block rounded-lg shadow-sm mb-4"><img src={qrCode} alt="QR" className="w-40 h-40 mix-blend-multiply" /></div>
              <div className="text-left bg-white p-4 rounded-lg border border-blue-100 shadow-sm">
                <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">Manual Entry Key:</p>
                <p className="font-mono text-lg tracking-widest text-gray-800 break-all select-all font-bold">{manualKey}</p>
              </div>
            </div>
          )}
        </div>

        {/* Live Structure View */}
        <div className="w-full lg:w-1/2">
          <div className="bg-white p-6 rounded-xl shadow-sm h-full overflow-y-auto max-h-[800px] border border-gray-200">
            <h3 className="font-bold text-gray-500 uppercase text-xs tracking-wider mb-4 border-b pb-2">Organization Tree (Live)</h3>
            <div className="space-y-4">
              {Object.keys(structure).length === 0 && <p className="text-gray-400 text-center py-10">Loading structure...</p>}
              {Object.keys(structure).map(sub => (
                <div key={sub} className="border border-gray-100 rounded-lg p-4 hover:bg-gray-50 transition-colors hover:shadow-sm">
                  <h4 className="font-bold text-lg text-indigo-900 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500"></span>{sub}
                  </h4>
                  <div className="flex flex-wrap gap-2 mt-3 ml-4">
                    {(structure[sub] || []).map((stn, i) => (
                      <span key={i} className="bg-white text-gray-700 px-3 py-1 rounded-full text-sm border border-gray-200 font-medium shadow-sm">{stn}</span>
                    ))}
                    {(!structure[sub] || structure[sub].length === 0) && <span className="text-xs text-gray-400 italic">No stations assigned</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 2. MANAGE DIVISIONS PAGE
// ==========================================
function ManageDivisionsPage({ onBack }) {
  const [newSub, setNewSub] = useState('');
  const [newStations, setNewStations] = useState('');

  const [editSub, setEditSub] = useState('');
  const [editStations, setEditStations] = useState('');

  const [structure, setStructure] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchStructure();
    const interval = setInterval(fetchStructure, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchStructure = async () => {
    try {
      const res = await axios.get('http://localhost:5000/api/admin/structure');
      setStructure(res.data || {});
      if (editSub && res.data[editSub]) {
        setEditStations(prev => {
          const dbValue = res.data[editSub].join(', ');
          return prev === dbValue ? prev : dbValue;
        });
      }
    } catch (err) { console.error(err); }
  };

  const handleAdd = async () => {
    if (!newSub) return alert("Subdivision Name is required");
    setSaving(true);
    try {
      await axios.post('http://localhost:5000/api/admin/create-subdivision', { subdivision: newSub, stations: newStations });
      alert("Created Successfully!");
      setNewSub('');
      setNewStations('');
      fetchStructure();
    } catch (err) {
      alert(err.response?.data?.message || "Error creating.");
    }
    finally { setSaving(false); }
  };

  const handleEditSave = async () => {
    if (!editSub) return alert("Select a subdivision first");
    setSaving(true);
    try {
      await axios.post('http://localhost:5000/api/admin/update-stations-list', { subdivision: editSub, stations: editStations });
      alert("Updated Successfully!");
      setEditSub('');
      setEditStations('');
      fetchStructure();
    } catch (err) { alert("Error updating."); }
    finally { setSaving(false); }
  };

  const onSelectEditSub = (subName) => {
    setEditSub(subName);
    if (subName && structure[subName]) {
      setEditStations(structure[subName].join(', '));
    } else {
      setEditStations('');
    }
  };

  const handleRemoveSubdivision = async (subdivision) => {
    if (!window.confirm(`⚠️ WARNING: Deleting ${subdivision} will also delete ALL USERS and MANAGERS in it. Continue?`)) return;
    try {
      await axios.post('http://localhost:5000/api/admin/delete-subdivision', { subdivision });
      if (editSub === subdivision) { setEditSub(''); setEditStations(''); }
      fetchStructure();
    } catch (err) { alert("Error deleting."); }
  };

  const handleRemoveStation = async (subdivision, stationToRemove) => {
    if (!window.confirm(`⚠️ Remove station '${stationToRemove}'? Users assigned to this station will be deleted.`)) return;
    const currentStations = structure[subdivision] || [];
    const newStationsList = currentStations.filter(s => s !== stationToRemove).join(', ');
    try {
      await axios.post('http://localhost:5000/api/admin/update-stations-list', { subdivision, stations: newStationsList });
      if (editSub === subdivision) {
        setEditStations(newStationsList);
      }
      fetchStructure();
    } catch (err) { alert("Error removing station"); }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <button onClick={onBack} className="mb-6 font-bold flex items-center gap-2 text-gray-600 hover:text-black transition-colors">
        <span className="text-xl">←</span> Back to Dashboard
      </button>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-md border-t-4 border-green-500">
          <h2 className="text-xl font-bold mb-4 text-green-800 flex items-center gap-2">
            ➕ Add New Subdivision
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">New Subdivision Name</label>
              <input value={newSub} onChange={e => setNewSub(e.target.value)} className="w-full border p-2 rounded-lg focus:ring-2 focus:ring-green-500 outline-none" placeholder="e.g. Traffic North" />
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Initial Stations (Comma Separated)</label>
              <textarea value={newStations} onChange={e => setNewStations(e.target.value)} className="w-full border p-2 rounded-lg h-24 focus:ring-2 focus:ring-green-500 outline-none resize-none" placeholder="Station A, Station B" />
            </div>
            <button onClick={handleAdd} disabled={saving} className="w-full bg-green-600 text-white py-2.5 rounded-lg font-bold hover:bg-green-700 transition-colors shadow-sm disabled:opacity-50">
              {saving ? 'Saving...' : 'Create Subdivision'}
            </button>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-md border-t-4 border-blue-500">
          <h2 className="text-xl font-bold mb-4 text-blue-800 flex items-center gap-2">
            ✏️ Edit Stations
          </h2>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Select Subdivision to Edit</label>
              <select value={editSub} onChange={e => onSelectEditSub(e.target.value)} className="w-full border p-2 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                <option value="">-- Choose Subdivision --</option>
                {Object.keys(structure).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                Update Stations (Comma Separated)
              </label>
              <textarea
                value={editStations}
                onChange={e => setEditStations(e.target.value)}
                disabled={!editSub}
                className="w-full border p-2 rounded-lg h-24 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none resize-none disabled:cursor-not-allowed"
              />
            </div>
            <button onClick={handleEditSave} disabled={saving || !editSub} className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
        <h3 className="font-bold text-xl mb-6 text-gray-800 border-b pb-4">Current Organization Structure</h3>
        <div className="grid grid-cols-1 gap-6">
          {Object.keys(structure).length === 0 && <p className="text-gray-400 italic">No structure found.</p>}
          {Object.keys(structure).map(sub => (
            <div key={sub} className="bg-gray-50 p-5 rounded-lg border border-gray-200 hover:border-indigo-200 transition-colors">
              <div className="flex justify-between items-center mb-4">
                <h4 className="font-bold text-lg text-indigo-900">{sub}</h4>
                <button onClick={() => handleRemoveSubdivision(sub)} className="text-red-500 hover:text-red-700 text-xs font-bold border border-red-200 px-3 py-1.5 rounded bg-white hover:bg-red-50 transition-colors">
                  Delete Subdivision
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {(structure[sub] || []).map(stn => (
                  <div key={stn} className="bg-white text-gray-700 px-3 py-1.5 rounded-md text-sm font-medium border border-gray-200 shadow-sm flex items-center gap-2 group hover:border-red-300 transition-colors">
                    {stn}
                    <button
                      onClick={() => handleRemoveStation(sub, stn)}
                      className="text-gray-300 hover:text-red-600 font-bold leading-none ml-1 transition-colors text-lg"
                      title="Remove Station"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {(structure[sub] || []).length === 0 && <span className="text-gray-400 italic text-sm">No stations assigned</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 3. MANAGE GROUPS PAGE
// ==========================================
function ManageGroupsPage({ onBack }) {
  const [activeTab, setActiveTab] = useState('create'); // 'create' | 'list'

  const [groups, setGroups] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  // Create Mode States
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [structure, setStructure] = useState({});

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [gRes, uRes, sRes] = await Promise.all([
        axios.get('http://localhost:5000/api/manager/groups'),
        axios.get('http://localhost:5000/api/admin/users'),
        axios.get('http://localhost:5000/api/admin/structure')
      ]);
      setGroups(gRes.data);
      // Filter out Admins and Managers
      setUsers(uRes.data.filter(u => u.role !== 'Admin' && u.role !== 'Manager'));
      setStructure(sRes.data || {});
    } catch (err) { console.error("Error fetching data", err); }
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim() || selectedUsers.length === 0) return alert("Enter name and select users");
    setLoading(true);
    try {
      await axios.post('http://localhost:5000/api/manager/create-group', {
        groupName: newGroupName,
        userIds: selectedUsers,
        managerId: 'Admin'
      });
      alert('Group Created!');
      setNewGroupName('');
      setSelectedUsers([]);
      fetchData();
      setActiveTab('list');
    } catch (err) { alert("Error creating group"); }
    finally { setLoading(false); }
  };

  const handleDeleteGroup = async (groupId) => {
    if (!window.confirm("Delete this group globally?")) return;
    try {
      await axios.post('http://localhost:5000/api/manager/delete-group', { groupId });
      fetchData();
    } catch (err) { alert("Error deleting group"); }
  };

  const handleRemoveMember = async (groupId, memberId) => {
    if (!window.confirm("Remove this user from the group?")) return;
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    const newUserIds = group.userIds.filter(id => id !== memberId);
    try {
      await axios.post('http://localhost:5000/api/admin/update-group', { groupId, userIds: newUserIds });
      fetchData();
    } catch (err) { alert("Error removing member"); }
  };

  const toggleUserSelection = (id) => {
    setSelectedUsers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleSubdivisionSelection = (subdivision, subUsers) => {
    const idsInSub = subUsers.map(u => u.id);
    const allSelected = idsInSub.length > 0 && idsInSub.every(id => selectedUsers.includes(id));

    if (allSelected) {
      // Unselect all
      setSelectedUsers(prev => prev.filter(id => !idsInSub.includes(id)));
    } else {
      // Select all (add missing)
      const toAdd = idsInSub.filter(id => !selectedUsers.includes(id));
      setSelectedUsers(prev => [...prev, ...toAdd]);
    }
  };

  const filteredUsers = users.filter(u => u.name.toLowerCase().includes(searchTerm.toLowerCase()));

  const groupedUsers = useMemo(() => {
    const grouped = {};

    // Add "Unknown" for users without a valid subdivision
    grouped['Unknown'] = [];

    // Populate with filtered users
    filteredUsers.forEach(u => {
      const sub = u.subdivision || 'Unknown';
      if (!grouped[sub]) grouped[sub] = [];
      grouped[sub].push(u);
    });

    // Remove Unknown if empty, sort others
    if (grouped['Unknown'].length === 0) delete grouped['Unknown'];

    return Object.keys(grouped).sort().map(key => ({ division: key, users: grouped[key] }));
  }, [filteredUsers]);

  const getGroupMembers = (userIds) => {
    return userIds.map(id => users.find(u => u.id === id)).filter(Boolean);
  };

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Header & Tabs */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
        <button onClick={onBack} className="font-bold flex items-center gap-2 text-gray-500 hover:text-black transition-colors self-start md:self-auto">
          <span className="text-xl">←</span> Dashboard
        </button>

        <div className="flex bg-white p-1 rounded-lg shadow-sm border border-gray-200">
          <button
            onClick={() => setActiveTab('create')}
            className={`px-6 py-2 rounded-md font-bold text-sm transition-all ${activeTab === 'create' ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            ➕ Create Group
          </button>
          <button
            onClick={() => setActiveTab('list')}
            className={`px-6 py-2 rounded-md font-bold text-sm transition-all ${activeTab === 'list' ? 'bg-purple-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}
          >
            👥 Existing Groups
          </button>
        </div>
      </div>

      {activeTab === 'create' && (
        <div className="space-y-6 animate-fade-in">
          {/* Top Bar: Name & Actions */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 flex flex-col md:flex-row gap-4 items-end sticky top-4 z-20">
            <div className="flex-1 w-full relative">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Search Users</label>
              <input
                placeholder="Type to filter users..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full border border-gray-200 p-3 rounded-lg bg-gray-50 focus:bg-white focus:ring-2 focus:ring-purple-200 outline-none transition-colors"
              />
            </div>

            <div className="flex-1 w-full">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Group Name</label>
              <input
                placeholder=" Enter name"
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                className="w-full border-2 border-gray-200 p-3 rounded-lg focus:border-purple-500 outline-none font-bold text-gray-800 transition-colors"
              />
            </div>

            <div className="w-full md:w-auto flex flex-col items-end">
              <span className="text-xs font-bold text-purple-600 mb-2">{selectedUsers.length} Users Selected</span>
              <button onClick={handleCreateGroup} disabled={loading} className="w-full md:w-auto bg-purple-600 text-white px-8 py-3 rounded-lg font-bold hover:bg-purple-700 transition-colors shadow-md disabled:opacity-50">
                {loading ? 'Creating...' : 'Save Group'}
              </button>
            </div>
          </div>

          {/* User Selection Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {groupedUsers.length === 0 && <div className="col-span-full text-center py-20 text-gray-400">No users found.</div>}

            {groupedUsers.map(group => {
              const allSelected = group.users.length > 0 && group.users.every(u => selectedUsers.includes(u.id));
              const someSelected = group.users.some(u => selectedUsers.includes(u.id));

              return (
                <div key={group.division} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-[400px]">
                  {/* Header */}
                  <div
                    onClick={() => toggleSubdivisionSelection(group.division, group.users)}
                    className={`p-3 border-b border-gray-100 flex justify-between items-center cursor-pointer transition-colors ${allSelected ? 'bg-purple-600 text-white' : 'bg-gray-50 hover:bg-gray-100'}`}
                  >
                    <h4 className={`font-bold text-sm uppercase truncate ${allSelected ? 'text-white' : 'text-gray-700'}`}>{group.division}</h4>

                    <div className={`w-5 h-5 rounded border flex items-center justify-center ${allSelected ? 'bg-white border-white' : 'bg-white border-gray-300'}`}>
                      {allSelected && <span className="text-purple-600 text-xs font-bold">✓</span>}
                      {!allSelected && someSelected && <span className="text-purple-600 text-xs font-bold">-</span>}
                    </div>
                  </div>

                  {/* List */}
                  <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                    {group.users.map(u => (
                      <label key={u.id} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-all mb-1 ${selectedUsers.includes(u.id) ? 'bg-purple-50 ring-1 ring-purple-200' : ''}`}>
                        <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={() => toggleUserSelection(u.id)} className="w-4 h-4 accent-purple-600" />
                        <div className="flex flex-col min-w-0">
                          <span className={`text-sm truncate ${selectedUsers.includes(u.id) ? 'font-bold text-purple-900' : 'text-gray-700'}`}>{u.name}</span>
                          <span className="text-[10px] text-gray-400 truncate">{u.station}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                  <div className="p-2 bg-gray-50 text-[10px] text-center text-gray-400 border-t border-gray-100">
                    {group.users.filter(u => selectedUsers.includes(u.id)).length} / {group.users.length} Selected
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'list' && (
        <GroupListMasterView
          groups={groups}
          users={users}
          structure={structure}
          onDeleteGroup={handleDeleteGroup}
          onUpdateGroup={handleRemoveMember}
        />
      )}
    </div>
  );
}

// Sub-component: Master View (Grid of Cards) -> Details View (Full Page)
function GroupListMasterView({ groups, users, structure, onDeleteGroup, onUpdateGroup }) {
  const [selectedGroupId, setSelectedGroupId] = useState(null); // Store only the ID

  // Find the currently selected group from the updated 'groups' prop
  const selectedGroup = useMemo(() => {
    return groups.find(g => g.id === selectedGroupId);
  }, [groups, selectedGroupId]);

  const [searchTerm, setSearchTerm] = useState('');

  // Helper to get members for a given group object
  const getGroupMembers = useCallback((groupObj) => {
    if (!groupObj) return [];
    return groupObj.userIds.map(id => users.find(u => u.id === id)).filter(Boolean);
  }, [users]);

  if (selectedGroup) {
    return (
      <GroupDetailsView
        group={selectedGroup}
        members={getGroupMembers(selectedGroup)} // Pass members derived from the fresh selectedGroup
        structure={structure}
        onBack={() => setSelectedGroupId(null)}
        onRemoveMember={onUpdateGroup} // Pass the parent's update handler directly
      />
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="mb-4">
        <input
          placeholder="🔍 Search existing groups..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="w-full md:w-1/3 border p-3 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none text-gray-700 shadow-sm"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {groups.filter(g => g.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && <div className="col-span-full text-center py-20 text-gray-400 italic">No groups found using search.</div>}

        {groups.filter(g => g.name.toLowerCase().includes(searchTerm.toLowerCase())).map(group => {
          const members = getGroupMembers(group); // Use the helper with the current group object
          return (
            <div
              key={group.id}
              onClick={() => { console.log("Group clicked:", group.id); setSelectedGroupId(group.id); }} // Set only the ID
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md transition-all cursor-pointer group hover:border-purple-300 flex flex-col justify-between h-[180px]"
            >
              <div>
                <div className="flex justify-between items-start mb-2">
                  <h3 className="text-lg font-bold text-gray-800 line-clamp-2">{group.name}</h3>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteGroup(group.id); }}
                    className="bg-red-50 text-red-500 p-2 rounded-lg hover:bg-red-100 transition-colors"
                    title="Delete Group"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                  </button>
                </div>
                <p className="text-xs text-gray-400 mb-4">Created by {group.createdBy || 'Admin'}</p>
              </div>

              <div>
                <div className="flex -space-x-2 overflow-hidden mb-3">
                  {members.slice(0, 5).map((m, i) => (
                    <div key={i} className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-purple-100 flex items-center justify-center text-xs font-bold text-purple-600 uppercase" title={m.name}>
                      {m.name.charAt(0)}
                    </div>
                  ))}
                  {members.length > 5 && (
                    <div className="inline-block h-8 w-8 rounded-full ring-2 ring-white bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">+{members.length - 5}</div>
                  )}
                </div>
                <span className="text-sm font-bold text-purple-700 bg-purple-50 px-3 py-1 rounded-full">{members.length} Members</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Sub-component: Details View (Full Page)
function GroupDetailsView({ group, members, structure, onBack, onRemoveMember }) {
  // Filters
  const [filterSub, setFilterSub] = useState('');
  const [filterStation, setFilterStation] = useState('');

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  const availableSubs = [...new Set(members
    .filter(u => u.subdivision && u.subdivision !== 'HQ')
    .map(u => u.subdivision)
  )].sort();

  const availableStations = [...new Set(members
    .filter(u => !filterSub || u.subdivision === filterSub)
    .filter(u => u.station && u.station !== 'Headquarters')
    .map(u => u.station)
  )].sort();

  const displayedUsers = members.filter(user => {
    if (filterSub && user.subdivision !== filterSub) return false;
    if (filterStation && user.station !== filterStation) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const nameMatch = user.name?.toLowerCase().includes(query);
      const emailMatch = user.email?.toLowerCase().includes(query) || (user.emails && user.emails.some(e => e.toLowerCase().includes(query)));
      const phoneMatch = user.phone?.toLowerCase().includes(query);
      const tagMatch = user.tagNumber?.toLowerCase().includes(query);
      if (!nameMatch && !emailMatch && !phoneMatch && !tagMatch) return false;
    }
    return true;
  });

  return (
    <div className="animate-fade-in space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-gray-500 hover:text-black font-bold transition-colors">
        <span className="text-xl">←</span> Back to Groups List
      </button>

      <div className="flex justify-between items-center mb-2">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">{group.name}</h2>
          <p className="text-gray-500 mt-1">Group Details • {members.length} Total Members</p>
        </div>
        <span className="bg-indigo-100 text-indigo-800 px-4 py-1 rounded-full font-bold text-sm shadow-sm">{displayedUsers.length} Found</span>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm mb-6 border border-gray-200 flex flex-col md:flex-row gap-4 items-center">
        <div className="w-full md:w-1/3 relative">
          <input
            type="text"
            placeholder="🔍 Search Name, Phone, Tag or Email..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full border p-2.5 rounded-lg pl-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          />
        </div>

        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center flex-1">
          <div className="font-bold text-gray-400 text-xs uppercase tracking-wide mr-2">Filters:</div>

          <select value={filterSub} onChange={e => { setFilterSub(e.target.value); setFilterStation(''); }} className="border p-2 rounded-lg bg-white font-medium text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">All Subdivisions</option>
            {availableSubs.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          <select value={filterStation} onChange={e => setFilterStation(e.target.value)} className="border p-2 rounded-lg bg-white font-medium text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-100 disabled:text-gray-400" disabled={!filterSub && availableStations.length > 20}>
            <option value="">All Stations</option>
            {availableStations.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {(filterSub || filterStation || searchQuery) && (
          <button onClick={() => { setFilterSub(''); setFilterStation(''); setSearchQuery(''); }} className="text-sm text-red-600 hover:text-red-800 font-bold whitespace-nowrap px-3 py-1 rounded hover:bg-red-50 transition-colors">
            Clear Filters
          </button>
        )}
      </div>

      <div className="bg-white shadow-sm rounded-xl overflow-hidden border border-gray-200">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Name</th>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Role</th>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Division / Station</th>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Tag No.</th>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Phone</th>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Email(s)</th>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {displayedUsers.length === 0 ? (
              <tr><td colSpan="7" className="p-10 text-center text-gray-400 italic">No members found matching your filters.</td></tr>
            ) : (
              displayedUsers.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4 font-semibold text-gray-800">{u.name}</td>
                  <td className="p-4"><span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${u.role === 'Admin' ? 'bg-purple-50 text-purple-700 border-purple-200' : u.role === 'Manager' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-green-50 text-green-700 border-green-200'}`}>{u.role}</span></td>
                  <td className="p-4 text-gray-600 text-sm">
                    {u.role === 'Admin' ? <span className="text-gray-400 italic">Headquarters</span> : (
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-800">{u.subdivision}</span>
                        {u.station && <span className="text-xs text-gray-500">{u.station}</span>}
                      </div>
                    )}
                  </td>
                  <td className="p-4 text-sm text-gray-700 font-mono font-bold bg-yellow-50">{u.tagNumber || '-'}</td>
                  <td className="p-4 text-sm text-gray-700 font-mono">{u.phone || '-'}</td>
                  <td className="p-4 text-sm">
                    <div className="flex flex-wrap gap-1 max-w-md">
                      {(u.emails && u.emails.length > 0 ? u.emails : (u.email ? u.email.split(',').map(e => e.trim()) : [])).map((email, idx) => (
                        <span key={idx} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-mono border border-blue-200">
                          {email}
                        </span>
                      ))}
                      {(!u.emails || u.emails.length === 0) && !u.email && <span className="text-gray-400 italic">-</span>}
                    </div>
                  </td>
                  <td className="p-4 text-center">
                    <button onClick={() => onRemoveMember(group.id, u.id)} className="text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-1.5 rounded text-xs font-bold transition-colors border border-transparent hover:border-red-200">
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================
// 4. MANAGE USERS VIEW
// ==========================================
function ManageUsersPage({ onBack }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterRole, setFilterRole] = useState('');
  const [filterSub, setFilterSub] = useState('');
  const [filterStation, setFilterStation] = useState('');

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchUsers();
    const interval = setInterval(fetchUsers, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchUsers = () => {
    axios.get('http://localhost:5000/api/admin/users').then(res => { setUsers(res.data); setLoading(false); });
  };

  const deleteUser = async (id) => {
    if (!window.confirm("Are you sure you want to delete this user?")) return;
    try { await axios.post('http://localhost:5000/api/admin/delete-user', { userId: id }); fetchUsers(); } catch (err) { alert("Error deleting user"); }
  };

  const availableSubs = [...new Set(users
    .filter(u => !filterRole || u.role === filterRole)
    .filter(u => u.subdivision && u.subdivision !== 'HQ')
    .map(u => u.subdivision)
  )].sort();

  const availableStations = [...new Set(users
    .filter(u => !filterRole || u.role === filterRole)
    .filter(u => !filterSub || u.subdivision === filterSub)
    .filter(u => u.station && u.station !== 'Headquarters')
    .map(u => u.station)
  )].sort();

  const displayedUsers = users.filter(user => {
    if (filterRole && user.role !== filterRole) return false;
    if (filterSub && user.subdivision !== filterSub) return false;
    if (filterStation && user.station !== filterStation) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const nameMatch = user.name?.toLowerCase().includes(query);
      const emailMatch = user.email?.toLowerCase().includes(query) || (user.emails && user.emails.some(e => e.toLowerCase().includes(query)));
      const phoneMatch = user.phone?.toLowerCase().includes(query);
      const tagMatch = user.tagNumber?.toLowerCase().includes(query);
      if (!nameMatch && !emailMatch && !phoneMatch && !tagMatch) return false;
    }
    return true;
  });

  return (
    <div className="max-w-6xl mx-auto p-6">
      <button onClick={onBack} className="mb-6 font-bold flex items-center gap-2 text-gray-600 hover:text-black transition-colors">
        <span className="text-xl">←</span> Back to Dashboard
      </button>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">System Users (Live)</h2>
        <span className="bg-indigo-100 text-indigo-800 px-4 py-1 rounded-full font-bold text-sm shadow-sm">{displayedUsers.length} Found</span>
      </div>

      <div className="bg-white p-4 rounded-xl shadow-sm mb-6 border border-gray-200 flex flex-col md:flex-row gap-4 items-center">
        <div className="w-full md:w-1/3 relative">
          <input
            type="text"
            placeholder="🔍 Search Name, Phone, Tag or Email..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full border p-2.5 rounded-lg pl-3 bg-gray-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          />
        </div>

        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center flex-1">
          <div className="font-bold text-gray-400 text-xs uppercase tracking-wide mr-2">Filters:</div>

          <select value={filterRole} onChange={e => { setFilterRole(e.target.value); setFilterSub(''); setFilterStation(''); }} className="border p-2 rounded-lg bg-white font-medium text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
            <option value="">All Roles</option>
            <option value="User">User</option>
            <option value="Manager">Manager</option>
            <option value="Admin">Admin</option>
          </select>

          {filterRole !== 'Admin' && (
            <>
              <select value={filterSub} onChange={e => { setFilterSub(e.target.value); setFilterStation(''); }} className="border p-2 rounded-lg bg-white font-medium text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                <option value="">All Subdivisions</option>
                {availableSubs.map(s => <option key={s} value={s}>{s}</option>)}
              </select>

              <select value={filterStation} onChange={e => setFilterStation(e.target.value)} className="border p-2 rounded-lg bg-white font-medium text-sm focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-gray-100 disabled:text-gray-400" disabled={!filterSub && availableStations.length > 20}>
                <option value="">All Stations</option>
                {availableStations.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </>
          )}
        </div>

        {(filterRole || filterSub || filterStation || searchQuery) && (
          <button onClick={() => { setFilterRole(''); setFilterSub(''); setFilterStation(''); setSearchQuery(''); }} className="text-sm text-red-600 hover:text-red-800 font-bold whitespace-nowrap px-3 py-1 rounded hover:bg-red-50 transition-colors">
            Clear Filters
          </button>
        )}
      </div>

      <div className="bg-white shadow-sm rounded-xl overflow-hidden border border-gray-200">
        <table className="w-full text-left border-collapse">
          <thead className="bg-gray-50">
            <tr>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Name</th>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Role</th>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Division / Station</th>
              {/* Tag Number Header */}
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Tag No.</th>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Phone</th>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider">Email(s)</th>
              <th className="p-4 border-b font-bold text-gray-500 uppercase text-xs tracking-wider text-center">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {displayedUsers.length === 0 ? (
              <tr><td colSpan="7" className="p-10 text-center text-gray-400 italic">No users found matching your filters.</td></tr>
            ) : (
              displayedUsers.map(u => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-4 font-semibold text-gray-800">{u.name}</td>
                  <td className="p-4"><span className={`px-2.5 py-0.5 rounded-full text-xs font-bold border ${u.role === 'Admin' ? 'bg-purple-50 text-purple-700 border-purple-200' : u.role === 'Manager' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-green-50 text-green-700 border-green-200'}`}>{u.role}</span></td>
                  <td className="p-4 text-gray-600 text-sm">
                    {u.role === 'Admin' ? <span className="text-gray-400 italic">Headquarters</span> : (
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-800">{u.subdivision}</span>
                        {u.station && <span className="text-xs text-gray-500">{u.station}</span>}
                      </div>
                    )}
                  </td>
                  {/* Tag Number Data */}
                  <td className="p-4 text-sm text-gray-700 font-mono font-bold bg-yellow-50">{u.tagNumber || '-'}</td>
                  <td className="p-4 text-sm text-gray-700 font-mono">{u.phone || '-'}</td>
                  <td className="p-4 text-sm">
                    <div className="flex flex-wrap gap-1 max-w-md">
                      {(u.emails && u.emails.length > 0 ? u.emails : (u.email ? u.email.split(',').map(e => e.trim()) : [])).map((email, idx) => (
                        <span key={idx} className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-mono border border-blue-200">
                          {email}
                        </span>
                      ))}
                      {(!u.emails || u.emails.length === 0) && !u.email && <span className="text-gray-400 italic">-</span>}
                    </div>
                  </td>
                  <td className="p-4 text-center">
                    <button onClick={() => deleteUser(u.id)} className="text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-1.5 rounded text-xs font-bold transition-colors border border-transparent hover:border-red-200">
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}