import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';

export default function ManagerPanel({ currentUser }) {
  const [currentView, setCurrentView] = useState('dashboard');
  const [selectedReportData, setSelectedReportData] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [groups, setGroups] = useState([]);

  const fetchData = useCallback(async () => {
    if (!currentUser) return;
    try {
      // 1. Fetch Users
      const usersRes = await axios.get('http://localhost:5000/api/admin/users');

      // UPDATED: Filter out Admins (HQ) so they don't show in lists
      const rawUsers = usersRes.data;
      const filteredUsers = rawUsers.filter(u => {
        const role = (u.role || '').trim().toLowerCase();
        return role !== 'admin' && role !== 'manager'; // Hides Admins & Managers
      });
      setAllUsers(filteredUsers);

      // 2. Fetch Groups
      const groupRes = await axios.get('http://localhost:5000/api/manager/groups');
      setGroups(groupRes.data);

      // 3. Fetch Tasks
      const tasksRes = await axios.post('http://localhost:5000/api/manager/all-tasks', {
        managerId: currentUser.id
      });
      setTasks(tasksRes.data);

    } catch (err) {
      console.error("Error fetching data:", err);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) fetchData();
    const interval = setInterval(() => {
      if (currentUser) fetchData();
    }, 5000);
    return () => clearInterval(interval);
  }, [currentUser, fetchData]);

  const handleOpenReport = (sheetName, sheetType) => {
    setSelectedReportData({ name: sheetName, type: sheetType });
    setCurrentView('report');
  };

  const handleReassign = async (taskId) => {
    if (!window.confirm("Re-assign this sheet? Status will reset to Pending.")) return;
    try {
      await axios.post('http://localhost:5000/api/manager/reassign', { taskId });
      alert("Sheet Re-Assigned.");
      fetchData();
    } catch (err) {
      alert("Error reassigning.");
    }
  };

  const handleMarkAllComplete = async (sheetName, sheetType, managerId, managerName) => {
    if (!window.confirm(`Mark all pending tasks for "${sheetName}" as completed?\n\nThis will complete all pending tasks for this sheet.`)) return;
    try {
      await axios.post('http://localhost:5000/api/manager/mark-all-complete', {
        sheetName,
        sheetType,
        managerId,
        managerName
      });
      alert("All tasks marked as completed.");
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || "Error marking tasks complete.");
    }
  };

  const handleArchiveSheet = async (sheetName, sheetType, managerId) => {
    if (!window.confirm(`Archive "${sheetName}"? This will hide it from the main view.`)) return;
    try {
      await axios.post('http://localhost:5000/api/manager/archive-sheet', {
        sheetName,
        sheetType,
        managerId
      });
      alert('Sheet archived successfully.');
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Error archiving sheet.');
    }
  };

  const handleUnarchiveSheet = async (sheetName, sheetType, managerId) => {
    if (!window.confirm(`Unarchive "${sheetName}"?`)) return;
    try {
      await axios.post('http://localhost:5000/api/manager/unarchive-sheet', {
        sheetName,
        sheetType,
        managerId
      });
      alert('Sheet unarchived successfully.');
      fetchData();
    } catch (err) {
      alert(err.response?.data?.message || 'Error unarchiving sheet.');
    }
  };

  return (
    <div className="flex h-screen w-full bg-gray-100 font-sans">
      <div className="w-64 bg-gray-900 text-white flex flex-col p-4 fixed h-full z-10">
        <div className="mb-8 border-b border-gray-700 pb-4">
          <h2 className="text-xl font-bold tracking-wide">Manager Portal</h2>
          <p className="text-gray-400 text-sm mt-1">{currentUser?.name}</p>
          <span className="text-xs bg-indigo-600 px-2 py-0.5 rounded mt-2 inline-block uppercase font-bold tracking-wider">
            {currentUser?.subdivision || 'HQ'}
          </span>
        </div>
        <nav className="space-y-2">
          <button onClick={() => setCurrentView('dashboard')} className={`w-full text-left px-4 py-3 rounded font-medium transition-all duration-200 ${currentView === 'dashboard' || currentView === 'report' ? 'bg-indigo-600 text-white shadow-lg translate-x-1' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
            📊 Analytics & Dashboard
          </button>
          <button onClick={() => setCurrentView('create')} className={`w-full text-left px-4 py-3 rounded font-medium transition-all duration-200 ${currentView === 'create' ? 'bg-indigo-600 text-white shadow-lg translate-x-1' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
            ➕ Assign & Groups
          </button>
          <button onClick={() => setCurrentView('validation')} className={`w-full text-left px-4 py-3 rounded font-medium transition-all duration-200 ${currentView === 'validation' ? 'bg-indigo-600 text-white shadow-lg translate-x-1' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
            🔍 Validation
          </button>
        </nav>
      </div>

      <div className="flex-1 ml-64 p-8 overflow-y-auto h-full">
        {currentView === 'dashboard' && (
          <AnalyticsDashboard
            tasks={tasks}
            groups={groups}
            refresh={fetchData}
            onOpenReport={handleOpenReport}
            handleReassign={handleReassign}
            handleMarkAllComplete={handleMarkAllComplete}
            handleArchiveSheet={handleArchiveSheet}
            handleUnarchiveSheet={handleUnarchiveSheet}
            currentUser={currentUser}
          />
        )}

        {currentView === 'report' && selectedReportData && (
          <SheetReport
            sheetName={selectedReportData.name}
            sheetType={selectedReportData.type}
            allTasks={tasks}
            onBack={() => setCurrentView('dashboard')}
            handleReassign={handleReassign}
            handleArchiveSheet={handleArchiveSheet}
            handleUnarchiveSheet={handleUnarchiveSheet}
            currentUser={currentUser}
          />
        )}

        {currentView === 'create' && (
          <BulkAssignPage allUsers={allUsers} groups={groups} refresh={fetchData} currentUser={currentUser} />
        )}

        {currentView === 'validation' && (
          <ValidationManagePage tasks={tasks} />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// SHEET REPORT VIEW
// ------------------------------------------------------------------
function SheetReport({ sheetName, sheetType, allTasks, onBack, handleReassign, handleArchiveSheet, handleUnarchiveSheet, currentUser }) {

  const sheetTasks = useMemo(() => {
    let filtered = allTasks.filter(t => t.sheetName === sheetName && t.sheetType === sheetType);
    return filtered.sort((a, b) => {
      const tagA = parseInt(a.userTagNumber) || 999999;
      const tagB = parseInt(b.userTagNumber) || 999999;
      return tagA - tagB;
    });
  }, [allTasks, sheetName, sheetType]);

  const stats = useMemo(() => {
    const submitted = sheetTasks.filter(t => t.status === 'Completed' && !t.isNil).length;
    const nil = sheetTasks.filter(t => t.isNil).length;
    const notSubmitted = sheetTasks.filter(t => t.status === 'Pending').length;
    const total = sheetTasks.length;
    const completionPercentage = total === 0 ? 0 : Math.round(((submitted + nil) / total) * 100);

    return {
      submitted,
      nil,
      notSubmitted,
      totalCompleted: submitted + nil,
      totalNotCompleted: notSubmitted,
      completionPercentage
    };
  }, [sheetTasks]);

  const formatDate = (isoString) => {
    if (!isoString) return '-';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '-';

    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${day}-${month}-${year} ${hours}:${mins} hrs`;
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg font-bold transition-colors">
            ← Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">Report: <span className="text-indigo-600">{sheetName}</span></h1>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{sheetType} Category</span>
          </div>
        </div>
        {(() => {
          // Check if sheet is archived by checking if any task in this sheet is archived
          const isArchived = sheetTasks.length > 0 && sheetTasks.some(t => t.isArchived);

          if (isArchived) {
            return (
              <button
                onClick={() => handleUnarchiveSheet(sheetName, sheetType, currentUser.id)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-bold transition-colors flex items-center gap-2"
              >
                📤 Unarchive Sheet
              </button>
            );
          } else {
            return (
              <button
                onClick={() => handleArchiveSheet(sheetName, sheetType, currentUser.id)}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg font-bold transition-colors flex items-center gap-2"
              >
                📦 Archive Sheet
              </button>
            );
          }
        })()}
      </div>

      {/* Dashboard Stats for This Sheet */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-6 mb-6">
        <StatCard title="Total Assigned" value={sheetTasks.length} color="blue" icon="👥" />
        <StatCard title="Pending Action" value={stats.notSubmitted} color="yellow" icon="⏳" />
        <StatCard title="Completed Reports" value={stats.submitted} color="green" icon="✅" />
        <StatCard title="Nil Reports" value={stats.nil} color="red" icon="🚫" />
        <div className="bg-white p-6 rounded-xl shadow-sm border border-indigo-100 flex flex-col justify-center items-center">
          <h3 className="text-gray-400 font-bold text-xs uppercase tracking-wider">Completion Rate</h3>
          <div className="text-4xl font-extrabold text-indigo-600 mt-2">{stats.completionPercentage}%</div>
          <span className="text-xs text-indigo-300 mt-1 font-bold uppercase">{sheetName}</span>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">

        {/* Detailed List Table - Now Full Width */}
        <div className="flex-1 bg-white shadow-sm border border-gray-200 rounded-xl overflow-hidden w-full">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-100 border-b border-gray-200 text-xs uppercase text-gray-600">
              <tr>
                <th className="p-3 border-r border-gray-200">PS Name</th>
                <th className="p-3 border-r border-gray-200">SDO</th>
                <th className="p-3 border-r border-gray-200">User Name</th>
                <th className="p-3 border-r border-gray-200">Phone</th>
                <th className="p-3 border-r border-gray-200">Tag No.</th>
                <th className="p-3 border-r border-gray-200">Status</th>
                <th className="p-3 border-r border-gray-200">Time</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {sheetTasks.map(task => (
                <tr key={task.taskId} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="p-3 border-r border-gray-100 font-semibold text-gray-700">{task.userStation}</td>
                  <td className="p-3 border-r border-gray-100 text-gray-600">{task.userSubdivision}</td>

                  <td className="p-3 border-r border-gray-100 font-bold text-gray-800">{task.userName}</td>
                  <td className="p-3 border-r border-gray-100 text-gray-600">{task.userPhone || '-'}</td>
                  <td className="p-3 border-r border-gray-100 font-mono text-xs font-bold text-indigo-600">
                    {task.userTagNumber ? `#${task.userTagNumber}` : '-'}
                  </td>

                  <td className="p-3 border-r border-gray-100">
                    {task.isNil ? (
                      <span className="text-red-600 font-bold bg-red-50 px-2 py-1 rounded text-xs">Nil report</span>
                    ) : task.status === 'Completed' ? (
                      <span className="text-green-600 font-bold bg-green-50 px-2 py-1 rounded text-xs">Submitted</span>
                    ) : (
                      <span className="text-orange-500 font-bold bg-orange-50 px-2 py-1 rounded text-xs">Not SUBMITTED</span>
                    )}
                  </td>

                  <td className="p-3 border-r border-gray-100 font-mono text-gray-500 text-xs">
                    {formatDate(task.completedDate)}
                  </td>

                  <td className="p-3">
                    {(task.status === 'Completed' || task.isNil) && (
                      <button
                        onClick={() => handleReassign(task.taskId)}
                        className="text-xs text-blue-600 hover:underline font-bold"
                      >
                        Reassign
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// ANALYTICS DASHBOARD
// ------------------------------------------------------------------
function AnalyticsDashboard({ tasks, groups, refresh, onOpenReport, handleReassign, handleMarkAllComplete, handleArchiveSheet, handleUnarchiveSheet, currentUser }) {
  const [activeTab, setActiveTab] = useState('Pending');
  const [filterType, setFilterType] = useState('New');
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const contextTasks = useMemo(() => {
    let filtered = tasks.filter(t => {
      const matchesType = t.sheetType === filterType;
      const query = searchQuery.toLowerCase();

      // Filter archived tasks based on toggle
      // When showArchived is true, show only archived sheets
      // When showArchived is false, show only unarchived sheets
      if (showArchived && !t.isArchived) return false;
      if (!showArchived && t.isArchived) return false;

      if (!query) return matchesType;

      let matchesSearch = (t.sheetName || '').toLowerCase().includes(query);

      return matchesType && matchesSearch;
    });

    return filtered.sort((a, b) => {
      const tagA = parseInt(a.userTagNumber) || 999999;
      const tagB = parseInt(b.userTagNumber) || 999999;

      if (tagA !== tagB) {
        return tagA - tagB;
      }
      const dateA = new Date(a.completedDate || a.date).getTime();
      const dateB = new Date(b.completedDate || b.date).getTime();
      return dateB - dateA;
    });

  }, [tasks, filterType, searchQuery, showArchived]);

  const pendingCount = contextTasks.filter(t => t.status === 'Pending').length;
  const nilCount = contextTasks.filter(t => t.isNil).length;
  const completedCount = contextTasks.filter(t => t.status === 'Completed' && !t.isNil).length;
  const percentage = (pendingCount + nilCount + completedCount) === 0 ? 0 : Math.round(((completedCount + nilCount) / (pendingCount + nilCount + completedCount)) * 100);

  // Group tasks by unique sheet (file-specific display)
  const uniqueSheets = useMemo(() => {
    // First, group ALL contextTasks by sheet (regardless of tab)
    const sheetMap = new Map();
    contextTasks.forEach(task => {
      const key = `${task.sheetName}_${task.sheetType}`;
      if (!sheetMap.has(key)) {
        sheetMap.set(key, {
          sheetName: task.sheetName,
          sheetType: task.sheetType,
          link: task.link,
          dueDate: task.dueDate,
          allTasks: []
        });
      }
      sheetMap.get(key).allTasks.push(task);
    });

    // Then filter sheets based on activeTab - only show sheets that have tasks in that tab
    return Array.from(sheetMap.values()).filter(sheet => {
      const hasMatchingTasks = sheet.allTasks.some(t => {
        if (activeTab === 'Pending') return t.status === 'Pending';
        if (activeTab === 'Completed') return t.status === 'Completed' && !t.isNil;
        if (activeTab === 'Nil') return t.isNil;
        return true;
      });
      return hasMatchingTasks;
    });
  }, [contextTasks, activeTab]);

  const displayTasks = uniqueSheets;

  return (
    <div className="max-w-7xl mx-auto space-y-8">

      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Dashboard Overview</h1>
      </div>
      <div className="flex bg-gray-100 p-1.5 rounded-full self-start md:self-center">
        {['New', 'Daily', 'Weekly', 'Fortnightly', 'Monthly'].map(type => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-6 py-2 mr-0.5 ml-0.5 rounded-full text-sm font-bold transition-all shadow-sm ${filterType === type ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:text-gray-800'
              }`}
          >
            {type}
          </button>
        ))}
      </div>
      {/* Main Control Area */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">

        {/* Top Row: Search & Filters */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 border-b border-gray-100 pb-6">

          <div className="w-full md:w-96">
            <div className="relative w-full">
              <input
                placeholder="🔍 Search Sheet Name..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-4 pr-4 py-2.5 rounded-full border text-sm focus:outline-none transition-all border-gray-300 bg-gray-50 focus:ring-2 focus:ring-gray-400"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none bg-gray-50 px-4 py-2 rounded-full border border-gray-200 hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <span className={`text-sm font-bold ${showArchived ? 'text-indigo-600' : 'text-gray-600'}`}>
                📦 Show Archived
              </span>
            </label>
          </div>


        </div>

        {/* Tabs */}
        <div className="flex gap-8 mb-6 border-b border-gray-200">
          {[
            { id: 'Pending', label: '⏳ Pending Tasks', count: pendingCount },
            { id: 'Completed', label: '✅ Completed', count: completedCount }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`pb-3 px-2 text-md font-bold transition-all border-b-4 ${activeTab === tab.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
            >
              {tab.label} <span className={`text-xs px-2 py-0.5 rounded-full ml-2 transition-colors ${activeTab === tab.id ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="p-4 font-semibold text-gray-500">Sheet Name</th>
                <th className="p-4 font-semibold text-gray-500">Total Assigned</th>
                <th className="p-4 font-semibold text-gray-500">{activeTab === 'Pending' ? 'Pending' : activeTab === 'Completed' ? 'Completed' : 'Nil Reports'}</th>
                <th className="p-4 font-semibold text-gray-500">Group / Division</th>
                <th className="p-4 font-semibold text-gray-500">Due Date</th>
                <th className="p-4 font-semibold text-gray-500">Link</th>
                <th className="p-4 font-semibold text-gray-500">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayTasks.length === 0 ? (
                <tr><td colSpan="7" className="p-12 text-center text-gray-400 italic bg-gray-50 rounded-b-lg">No {activeTab.toLowerCase()} records found matching criteria.</td></tr>
              ) : (
                displayTasks.map((sheet) => {
                  const totalAssigned = sheet.allTasks.length;
                  const statusCount = sheet.allTasks.filter(t => {
                    if (activeTab === 'Pending') return t.status === 'Pending';
                    if (activeTab === 'Completed') return t.status === 'Completed' && !t.isNil;
                    if (activeTab === 'Nil') return t.isNil;
                    return false;
                  }).length;

                  // Get unique groups/divisions
                  const groupsAndDivisions = [...new Set(sheet.allTasks.map(t => t.groupName || t.userSubdivision).filter(Boolean))];

                  return (
                    <tr key={`${sheet.sheetName}_${sheet.sheetType}`} className="hover:bg-indigo-50 transition-colors group">
                      <td onClick={() => onOpenReport(sheet.sheetName, sheet.sheetType)} className="p-4 font-bold text-indigo-600 cursor-pointer hover:underline hover:text-indigo-800">{sheet.sheetName}</td>
                      <td className="p-4 text-gray-800 font-semibold">
                        <span className="bg-gray-100 px-3 py-1 rounded-full text-sm font-bold">{totalAssigned}</span>
                      </td>
                      <td className="p-4">
                        <span className={`px-3 py-1 rounded-full text-sm font-bold ${activeTab === 'Pending' ? 'bg-yellow-100 text-yellow-700' :
                          activeTab === 'Completed' ? 'bg-green-100 text-green-700' :
                            'bg-red-100 text-red-700'
                          }`}>{statusCount}</span>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-wrap gap-1">
                          {groupsAndDivisions.length > 0 ? groupsAndDivisions.map((name, idx) => (
                            <span key={idx} className="bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs border border-gray-200 font-medium">
                              {name}
                            </span>
                          )) : <span className="text-gray-400 text-xs italic">-</span>}
                        </div>
                      </td>
                      <td className="p-4 text-gray-500 font-mono text-xs">
                        {(() => {
                          if (sheet.sheetType === 'Weekly') {
                            // For Weekly: show the day of week
                            const firstTask = sheet.allTasks[0];
                            return firstTask?.weeklyDay || '-';
                          } else if (sheet.sheetType === 'Daily') {
                            // For Daily: no specific due date
                            return '-';
                          } else {
                            // For New/Monthly: show the date
                            return sheet.dueDate ? new Date(sheet.dueDate).toLocaleDateString() : '-';
                          }
                        })()}
                      </td>
                      <td className="p-4">
                        {activeTab !== 'Nil' && <a href={sheet.link} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-800 hover:underline font-bold text-xs bg-indigo-50 px-3 py-1.5 rounded-md border border-indigo-100">OPEN SHEET ↗</a>}
                        {activeTab === 'Nil' && <span className="text-gray-300 text-xs italic">N/A</span>}
                      </td>

                      <td className="p-4">
                        {(() => {
                          const isArchived = sheet.allTasks.some(t => t.isArchived);
                          const allCompleted = sheet.allTasks.every(t => t.status === 'Completed' || t.isNil);
                          const hasPending = sheet.allTasks.some(t => t.status === 'Pending');

                          if (isArchived) {
                            return (
                              <button
                                onClick={() => handleUnarchiveSheet(sheet.sheetName, sheet.sheetType, currentUser.id)}
                                className="text-xs text-blue-600 hover:text-blue-800 font-bold bg-blue-50 px-3 py-1.5 rounded-md border border-blue-100 hover:bg-blue-100 transition-colors"
                              >
                                📤 Unarchive
                              </button>
                            );
                          } else if (allCompleted) {
                            return (
                              <button
                                onClick={() => handleArchiveSheet(sheet.sheetName, sheet.sheetType, currentUser.id)}
                                className="text-xs text-gray-600 hover:text-gray-800 font-bold bg-gray-50 px-3 py-1.5 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors"
                              >
                                📦 Archive
                              </button>
                            );
                          } else if (hasPending && activeTab === 'Pending') {
                            return (
                              <button
                                onClick={() => handleMarkAllComplete(sheet.sheetName, sheet.sheetType, currentUser.id, currentUser.name)}
                                className="text-xs text-green-600 hover:text-green-800 font-bold bg-green-50 px-3 py-1.5 rounded-md border border-green-200 hover:bg-green-100 transition-colors whitespace-nowrap"
                              >
                                ✅ Mark All Complete
                              </button>
                            );
                          } else {
                            return <span className="text-gray-400 text-xs italic">-</span>;
                          }
                        })()}
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, color, icon }) {
  const colors = {
    green: 'border-green-500 bg-green-50 text-green-700',
    yellow: 'border-yellow-500 bg-yellow-50 text-yellow-700',
    red: 'border-red-500 bg-red-50 text-red-700',
    blue: 'border-blue-500 bg-blue-50 text-blue-700'
  };
  return (
    <div className={`p-6 rounded-xl shadow-sm border-l-4 ${colors[color]} bg-white flex justify-between items-center transition-transform hover:-translate-y-1`}>
      <div><h3 className="text-gray-500 text-xs font-bold uppercase tracking-wider">{title}</h3><div className="text-3xl font-extrabold mt-1">{value}</div></div>
      <div className="text-2xl opacity-50">{icon}</div>
    </div>
  );
}

// ------------------------------------------------------------------
// BULK ASSIGN PAGE
// ------------------------------------------------------------------
function BulkAssignPage({ allUsers, groups, refresh, currentUser }) {
  const [sheetName, setSheetName] = useState('');
  const [type, setType] = useState('New');
  const [manualLink, setManualLink] = useState('');
  const [dueDateOnly, setDueDateOnly] = useState('');
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [period, setPeriod] = useState('AM');
  const [allowNil, setAllowNil] = useState(false);
  const [botConfirmed, setBotConfirmed] = useState(false);
  const [selectionMode, setSelectionMode] = useState('users');
  const [selUsers, setSelUsers] = useState([]);
  const [selGroups, setSelGroups] = useState([]);
  const [groupSearchTerm, setGroupSearchTerm] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);
  const [botEmail, setBotEmail] = useState('');
  const [weeklyDay, setWeeklyDay] = useState('Monday'); // For Weekly type
  const [fnDay1, setFnDay1] = useState('1'); // Fortnightly Day 1
  const [fnDay2, setFnDay2] = useState('15'); // Fortnightly Day 2

  useEffect(() => { axios.get('http://localhost:5000/api/system/bot-email').then((res) => setBotEmail(res.data.email)).catch((err) => console.error("Could not fetch bot email")); }, []);
  const copyToClipboard = () => { navigator.clipboard.writeText(botEmail); alert("Bot Email copied to clipboard!"); };
  const subdivisions = useMemo(() => { const subs = allUsers.map(u => u.subdivision || 'Unknown').filter(Boolean); return [...new Set(subs)].sort(); }, [allUsers]);
  const toggleUser = (id) => { setSelUsers((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  const toggleGroup = (id) => { setSelGroups((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  const toggleDivision = (divName) => {
    const usersInDiv = allUsers.filter(u => (u.subdivision || 'Unknown') === divName);
    const idsInDiv = usersInDiv.map(u => u.id);
    const allSelected = idsInDiv.every(id => selUsers.includes(id));
    if (allSelected) { setSelUsers(prev => prev.filter(id => !idsInDiv.includes(id))); } else { const toAdd = idsInDiv.filter(id => !selUsers.includes(id)); setSelUsers(prev => [...prev, ...toAdd]); }
  };
  const groupedFilteredUsers = useMemo(() => {
    const filtered = allUsers.filter((u) => u.name.toLowerCase().includes(searchTerm.toLowerCase()) || (u.station && u.station.toLowerCase().includes(searchTerm.toLowerCase())) || (u.subdivision && u.subdivision.toLowerCase().includes(searchTerm.toLowerCase())));
    const grouped = {};
    filtered.forEach(u => { const sub = u.subdivision || 'Unknown'; if (!grouped[sub]) grouped[sub] = []; grouped[sub].push(u); });
    return Object.keys(grouped).sort().map(key => ({ division: key, users: grouped[key] }));
  }, [allUsers, searchTerm]);
  const getGroupMembers = (groupId) => { const group = groups.find(g => g.id === groupId); if (!group) return []; return allUsers.filter(u => group.userIds.includes(u.id)); };
  const filteredGroups = groups.filter(g => g.name.toLowerCase().includes(groupSearchTerm.toLowerCase()));
  const handleAssign = async () => {
    if (!botConfirmed) return alert("Please confirm you shared the sheet with the bot.");
    if (!sheetName || !manualLink) return alert("Fill sheet name and link fields.");

    // For Daily sheets: only time is required (no date)
    // For New, Monthly, and Weekly: both date/day and time are required
    if (type === 'Daily') {
      // Daily only needs time
    } else if (type === 'Weekly') {
      // Weekly needs day of week and time
      if (!weeklyDay) return alert("Please select a day of the week for Weekly sheets.");
    } else if (type === 'Fortnightly') {
      const d1 = parseInt(fnDay1);
      const d2 = parseInt(fnDay2);
      if (isNaN(d1) || d1 < 1 || d1 > 31) return alert("Day 1 must be between 1 and 31");
      if (isNaN(d2) || d2 < 1 || d2 > 31) return alert("Day 2 must be between 1 and 31");
      if (d1 === d2) return alert("Please select two different days for Fortnightly sheets.");
    } else {
      // New and Monthly need specific date
      // Note: Fortnightly uses the calculated first occurrence as dueDate
      if (!dueDateOnly && type !== 'Fortnightly') return alert("Please select a due date.");
    }

    if (!hours || !minutes) return alert("Please enter hours and minutes for the due time.");

    // Validate hours and minutes
    const hoursNum = parseInt(hours);
    const minutesNum = parseInt(minutes);
    if (isNaN(hoursNum) || hoursNum < 1 || hoursNum > 12) return alert("Hours must be between 1 and 12.");
    if (isNaN(minutesNum) || minutesNum < 0 || minutesNum > 59) return alert("Minutes must be between 0 and 59.");

    // Convert to 24-hour format
    let hours24 = hoursNum;
    if (period === 'PM' && hoursNum !== 12) hours24 = hoursNum + 12;
    if (period === 'AM' && hoursNum === 12) hours24 = 0;

    // Build dueDate string
    let dueDate;
    if (type === 'Daily') {
      // For Daily sheets, just store the time (backend will ignore the date part)
      const today = new Date().toISOString().split('T')[0];
      dueDate = `${today}T${String(hours24).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`;
    } else if (type === 'Weekly') {
      // For Weekly sheets, use the selected date
      // We still send weeklyDay for the recurrence logic
      dueDate = `${dueDateOnly}T${String(hours24).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`;
    } else if (type === 'Fortnightly') {
      // Calculate first occurrence based on today
      const d1 = parseInt(fnDay1);
      const d2 = parseInt(fnDay2);

      const checkDate = (day) => {
        let date = new Date();
        date.setDate(day);

        // Handle short months or past days for initial check?
        // Simplest is: Create dates for current month d1/d2 and next month d1/d2.
        // Sort them. Pick the first one that is > Now.
        return date;
      };
      // Actually simplest is validation logic on backend or just send the first valid upcoming date
      // Let's implement a quick helper
      const getNextDate = (day) => {
        const now = new Date();
        const candidate = new Date();
        candidate.setDate(day);
        candidate.setHours(hours24, minutesNum, 0, 0);

        // If day doesn't exist (e.g. Feb 30), JS auto-rolls to Mar 2. We want to clamp or skip?
        // Sticky logic says clamp.
        if (date.getDate() !== day) {
          // It rolled over. Clamp to last day of prev month?
          // No, for finding the "Next" one, let's just use the current month/next month projection.
        }

        if (candidate <= now) {
          // Move to next month
          candidate.setMonth(candidate.getMonth() + 1);
          candidate.setDate(day); // Re-set day in case month length changed
        }
        return candidate;
      }

      // To be safe and simple: Calculate 4 candidates (Current D1, Current D2, Next D1, Next D2)
      // Filter those > Now. Sort. Pick first.
      const candidates = [];
      [0, 1].forEach(offset => {
        [d1, d2].forEach(day => {
          const d = new Date();
          d.setMonth(d.getMonth() + offset);
          // Clamp day
          const maxDays = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
          const actualDay = Math.min(day, maxDays);
          d.setDate(actualDay);
          d.setHours(hours24, minutesNum, 0, 0);
          candidates.push(d);
        });
      });

      const now = new Date();
      candidates.sort((a, b) => a - b);
      const next = candidates.find(c => c > now);

      if (!next) {
        // Should not happen, but fallback
        dueDate = new Date().toISOString();
      } else {
        const dateStr = next.toISOString().split('T')[0];
        dueDate = `${dateStr}T${String(hours24).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`;
      }

    } else {
      // For New/Monthly: Use specified date with specified time
      dueDate = `${dueDateOnly}T${String(hours24).padStart(2, '0')}:${String(minutesNum).padStart(2, '0')}`;
    }

    let targets = [];
    let groupNamesUsed = [];
    if (selectionMode === 'groups') {
      if (selGroups.length === 0) return alert("Select at least one group.");
      const allSelectedGroupIds = selGroups;
      const targetIds = new Set();
      allSelectedGroupIds.forEach(grpId => { const grp = groups.find(g => g.id === grpId); if (grp) { groupNamesUsed.push(grp.name); grp.userIds.forEach(uid => targetIds.add(uid)); } });
      targets = allUsers.filter((u) => targetIds.has(u.id)).map((u) => ({ id: u.id, name: u.name, email: u.email, emails: u.emails || (u.email ? u.email.split(',').map(e => e.trim()) : []) }));
    } else {
      if (selUsers.length === 0) return alert("Select users");
      targets = allUsers.filter((u) => selUsers.includes(u.id)).map((u) => ({ id: u.id, name: u.name, email: u.email, emails: u.emails || (u.email ? u.email.split(',').map(e => e.trim()) : []) }));
    }
    setLoading(true);
    try {
      await axios.post('http://localhost:5000/api/manager/assign-sheet', {
        type,
        sheetName,
        manualLink,
        targets,
        dueDate,
        allowNil,
        managerName: currentUser.name,
        managerId: currentUser.id,
        groupNameUsed: groupNamesUsed.join(', '),
        weeklyDay: type === 'Weekly' ? weeklyDay : '', // Send weeklyDay only for Weekly type
        fortnightlyDays: type === 'Fortnightly' ? `${fnDay1},${fnDay2}` : '' // Send both days for Fortnightly
      });
      alert(`Assigned to ${targets.length} users! You can now add columns to the Google Sheet and configure validation rules from the Validation menu.`);

      // Reset form after successful assignment
      setSelUsers([]);
      setSelGroups([]);
      setSheetName('');
      setManualLink('');
      setDueDateOnly('');
      setHours('');
      setMinutes('');
      setPeriod('AM');
      setBotConfirmed(false);
      setWeeklyDay('Monday');
      setFnDay1('1');
      setFnDay2('15');
      refresh();
    } catch (err) {
      alert(err.response?.data?.message || "Error assigning.");
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold mb-4 text-gray-800">Assign New Sheets</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="border-b border-gray-100 pb-4 mb-4"><h3 className="font-bold text-lg text-gray-800 flex items-center"><span className="bg-indigo-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs mr-2">1</span> Sheet Details</h3></div>
          <div className="bg-blue-50 p-4 rounded-md mb-6 border border-blue-100"><p className="text-xs text-blue-800 mb-2 font-semibold">Bot Service Email (Must be Editor):</p><div className="flex gap-2 mb-3"><input readOnly value={botEmail || 'Loading...'} className="text-xs bg-white border border-blue-200 p-2 rounded w-full text-gray-600" /><button onClick={copyToClipboard} className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 rounded font-bold transition-colors">Copy</button></div><label className="flex items-center gap-2 cursor-pointer select-none"><input type="checkbox" checked={botConfirmed} onChange={(e) => setBotConfirmed(e.target.checked)} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" /><span className="text-xs font-bold text-blue-700">I have shared the sheet with this email.</span></label></div>
          <div className="space-y-4"><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Category</label><div className="flex gap-1 bg-gray-100 rounded p-1">{['New', 'Daily', 'Weekly', 'Fortnightly', 'Monthly'].map((t) => (<button key={t} onClick={() => setType(t)} className={`flex-1 text-xs py-1.5 rounded font-bold transition-all ${type === t ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t}</button>))}</div></div><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Sheet Name</label><input value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="e.g. Monthly Crime Report" className="w-full border border-gray-300 p-2 text-sm rounded focus:ring-2 focus:ring-indigo-500 outline-none" /></div><div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Google Sheet Link</label><input value={manualLink} onChange={(e) => setManualLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/..." className="w-full border border-gray-300 p-2 text-sm rounded focus:ring-2 focus:ring-indigo-500 outline-none" /></div>          {/* Day of Week Selector for Weekly type */}
            {type === 'Weekly' && (<div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Cycle Day</label><select value={weeklyDay} onChange={(e) => setWeeklyDay(e.target.value)} className="w-full border border-gray-300 p-2 text-sm rounded focus:ring-2 focus:ring-indigo-500 outline-none bg-white font-bold"><option value="Monday">Monday</option><option value="Tuesday">Tuesday</option><option value="Wednesday">Wednesday</option><option value="Thursday">Thursday</option><option value="Friday">Friday</option><option value="Saturday">Saturday</option><option value="Sunday">Sunday</option></select></div>)}

            {/* Day Selectors for Fortnightly */}
            {type === 'Fortnightly' && (
              <div className="flex gap-4">
                <div className="flex-1"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">First Date</label><input type="number" min="1" max="31" value={fnDay1} onChange={(e) => setFnDay1(e.target.value)} className="w-full border border-gray-300 p-2 text-sm rounded focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="1" /></div>
                <div className="flex-1"><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Second Date</label><input type="number" min="1" max="31" value={fnDay2} onChange={(e) => setFnDay2(e.target.value)} className="w-full border border-gray-300 p-2 text-sm rounded focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="15" /></div>
              </div>
            )}

            {/* Only show Due Date for New, Monthly AND Weekly sheets (Not Fortnightly) */}
            {(type === 'New' || type === 'Monthly' || type === 'Weekly') && (<div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Due Date</label><input type="date" value={dueDateOnly} onChange={(e) => setDueDateOnly(e.target.value)} className="w-full border border-gray-300 p-2 text-sm rounded focus:ring-2 focus:ring-indigo-500 outline-none" /></div>)}<div><label className="block text-xs font-bold text-gray-500 uppercase mb-1">Due Time</label><div className="flex gap-2 items-center"><input type="text" value={hours} onChange={(e) => setHours(e.target.value.replace(/[^0-9]/g, ''))} placeholder="HH" maxLength="2" className="w-16 border border-gray-300 p-2 text-sm text-center rounded focus:ring-2 focus:ring-indigo-500 outline-none font-mono" /><span className="text-gray-400 font-bold">:</span><input type="text" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/[^0-9]/g, ''))} placeholder="MM" maxLength="2" className="w-16 border border-gray-300 p-2 text-sm text-center rounded focus:ring-2 focus:ring-indigo-500 outline-none font-mono" /><select value={period} onChange={(e) => setPeriod(e.target.value)} className="border border-gray-300 p-2 text-sm rounded focus:ring-2 focus:ring-indigo-500 outline-none bg-white font-bold"><option value="AM">AM</option><option value="PM">PM</option></select></div></div><div className="flex items-center pt-2"><label className="flex items-center gap-2 cursor-pointer bg-gray-50 p-2 rounded border border-gray-200 hover:bg-gray-100"><input type="checkbox" checked={allowNil} onChange={(e) => setAllowNil(e.target.checked)} className="w-4 h-4 text-indigo-600 rounded" /><span className="text-xs font-bold text-gray-700">Allow Nil?</span></label></div></div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 col-span-1 lg:col-span-2 flex flex-col h-[700px]">
          <div className="flex flex-col sm:flex-row justify-between items-center mb-4 border-b border-gray-100 pb-4"><h3 className="font-bold text-lg text-gray-800 flex items-center mb-2 sm:mb-0"><span className="bg-purple-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs mr-2">2</span> Select Targets</h3><div className="flex bg-gray-100 rounded p-1"><button onClick={() => setSelectionMode('users')} className={`px-4 py-1.5 rounded text-xs font-bold transition-all ${selectionMode === 'users' ? 'bg-white shadow text-purple-700' : 'text-gray-500'}`}>Individual & Divisions</button><button onClick={() => setSelectionMode('groups')} className={`px-4 py-1.5 rounded text-xs font-bold transition-all ${selectionMode === 'groups' ? 'bg-white shadow text-purple-700' : 'text-gray-500'}`}>Saved Groups</button></div></div>
          <div className="flex-1 flex flex-col min-h-0">
            {selectionMode === 'groups' ? (
              <div className="flex flex-col h-full gap-4"><input placeholder="🔍 Search Saved Groups..." value={groupSearchTerm} onChange={(e) => setGroupSearchTerm(e.target.value)} className="w-full border-b border-gray-200 p-2 text-sm focus:outline-none focus:border-purple-500" /><div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar p-1">{filteredGroups.length === 0 && <p className="text-center text-gray-400 text-sm py-10">No groups found.</p>}{filteredGroups.map(group => { const members = getGroupMembers(group.id); const isSelected = selGroups.includes(group.id); return (<div key={group.id} onClick={() => toggleGroup(group.id)} className={`border rounded-lg p-4 cursor-pointer transition-all relative group ${isSelected ? 'border-purple-500 bg-purple-50 shadow-md ring-1 ring-purple-500' : 'border-gray-200 hover:border-purple-300 hover:shadow-sm'}`}><div className="flex justify-between items-center mb-2"><div className="flex items-center gap-3"><div className={`w-5 h-5 flex items-center justify-center rounded border ${isSelected ? 'bg-purple-600 border-purple-600' : 'bg-white border-gray-300'}`}>{isSelected && <span className="text-white text-xs">✓</span>}</div><h4 className={`font-bold text-md ${isSelected ? 'text-purple-800' : 'text-gray-800'}`}>{group.name}</h4></div><div className="flex items-center gap-2"><span className="bg-gray-200 text-gray-600 text-[10px] px-2 py-0.5 rounded-full font-bold">{group.userIds.length} Members</span></div></div><div className="flex flex-wrap gap-2 ml-8">{members.length > 0 ? members.map(u => (<span key={u.id} className="text-xs bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded">{u.name}</span>)) : (<span className="text-xs text-red-400 italic">Members not found</span>)}</div></div>) })}</div></div>
            ) : (
              <div className="flex flex-col h-full gap-4"><input placeholder="🔍 Search users..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full border-b border-gray-200 p-2 text-sm focus:outline-none focus:border-purple-500" /><div className="flex-1 flex gap-4 min-h-0"><div className="w-1/3 border-r border-gray-100 pr-2 flex flex-col"><div className="text-xs font-bold text-gray-400 uppercase mb-2 tracking-wider">Subdivisions</div><div className="overflow-y-auto flex-1 space-y-1 custom-scrollbar">{subdivisions.map(sub => { const usersInSub = allUsers.filter(u => (u.subdivision || 'Unknown') === sub); const selectedInSub = usersInSub.filter(u => selUsers.includes(u.id)); const isAll = usersInSub.length > 0 && selectedInSub.length === usersInSub.length; const isSome = selectedInSub.length > 0 && !isAll; return (<div key={sub} onClick={() => toggleDivision(sub)} className={`cursor-pointer p-2 rounded text-sm flex items-center justify-between group transition-colors ${isAll ? 'bg-purple-100 text-purple-800 font-bold' : isSome ? 'bg-purple-50 text-purple-700' : 'hover:bg-gray-50 text-gray-700'}`}><span className="truncate">{sub}</span><div className={`w-4 h-4 min-w-[16px] rounded border flex items-center justify-center ${isAll ? 'bg-purple-600 border-purple-600' : isSome ? 'bg-purple-300 border-purple-300' : 'border-gray-300 bg-white'}`}>{isAll && <span className="text-white text-[10px]">✓</span>}{isSome && <span className="text-white text-[10px] font-bold">-</span>}</div></div>) })}</div></div><div className="w-2/3 flex flex-col"><div className="flex justify-between items-center mb-2"><div className="text-xs font-bold text-gray-400 uppercase tracking-wider">Users ({selUsers.length} Selected)</div></div><div className="overflow-y-auto flex-1 bg-gray-50 p-2 rounded-lg border border-gray-100 custom-scrollbar">{groupedFilteredUsers.length === 0 && <p className="text-center text-gray-400 text-xs py-10">No users found.</p>}{groupedFilteredUsers.map((group) => (<div key={group.division} className="mb-4"><div className="bg-gray-200 text-gray-600 px-2 py-1 text-xs font-bold uppercase rounded mb-1 shadow-sm">{group.division}</div><div className="space-y-1">{group.users.map((u) => (<label key={u.id} className={`flex items-center gap-3 p-2 rounded border cursor-pointer transition-all duration-200 ${selUsers.includes(u.id) ? 'bg-white border-purple-300 shadow-sm' : 'bg-transparent border-transparent hover:bg-white hover:border-gray-200'}`}><input type="checkbox" checked={selUsers.includes(u.id)} onChange={() => toggleUser(u.id)} className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500" /><div className="flex flex-col"><span className="text-sm font-semibold text-gray-800 leading-tight">{u.name}</span><span className="text-[10px] text-gray-500">{u.station}</span></div></label>))}</div></div>))}</div></div></div></div>
            )
            }
          </div>
          <div className="mt-4 pt-4 border-t border-gray-200"><button onClick={handleAssign} disabled={loading || !botConfirmed} className={`w-full py-4 rounded-lg text-white font-bold text-lg shadow-md transition-all flex items-center justify-center gap-2 ${loading || !botConfirmed ? 'bg-gray-300 cursor-not-allowed text-gray-500 shadow-none' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 transform hover:-translate-y-0.5'}`}>{loading ? 'Processing...' : selectionMode === 'groups' ? 'Assign Sheet to Selected Groups' : 'Assign Sheet to Selected Users'}</button>{!botConfirmed && (<p className="text-center text-xs text-red-500 mt-2 font-medium">Please check the "Shared with Bot" box above to enable this button.</p>)}</div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// SHEET VALIDATION MANAGER COMPONENT
// ------------------------------------------------------------------
// ------------------------------------------------------------------
// SINGLE SHEET VALIDATION COMPONENT
// ------------------------------------------------------------------
function SingleSheetValidation({ sheetName, sheetLink, sheetType, botEmail, botConfirmed, setBotConfirmed }) {
  const [loading, setLoading] = useState(false);
  const [hasExistingSchema, setHasExistingSchema] = useState(false);
  const [schema, setSchema] = useState([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResults, setValidationResults] = useState(null);
  const [showBotInfo, setShowBotInfo] = useState(false);

  useEffect(() => {
    // 2. Fetch Schema
    const fetchSchema = async () => {
      setLoading(true);
      try {
        console.log("Fetching schema for:", sheetName, sheetType, sheetLink); // DEBUG
        const res = await axios.post('http://localhost:5000/api/manager/get-sheet-schema', {
          sheet_link: sheetLink,
          sheet_name: sheetName,
          sheet_type: sheetType
        });

        if (res.data.success) {
          if (res.data.has_schema) {
            setHasExistingSchema(true);
            setSchema(Array.isArray(res.data.schema) ? res.data.schema : []);
            setIsEditMode(false);
            setBotConfirmed(true);
          } else {
            setHasExistingSchema(false);
            // Initialize new schema from headers
            const headers = Array.isArray(res.data.headers) ? res.data.headers : [];
            const newSchema = headers.map(header => ({
              name: header, type: 'text', required: false, length: '', isFixed: false, format: '', options: []
            }));
            setSchema(newSchema);
            setIsEditMode(true);
            setBotConfirmed(false);
          }
        }
      } catch (err) {
        console.error("Error fetching schema:", err);
        // Don't alert here to avoid spamming alerts for multiple sheets
      } finally {
        setLoading(false);
      }
    };
    fetchSchema();
  }, [sheetLink, sheetName, sheetType]);

  const handleFieldChange = (index, field, value) => {
    const updated = [...schema];
    updated[index] = { ...updated[index], [field]: value };
    if (field === 'type') {
      updated[index].format = '';
      updated[index].options = [];
      updated[index].length = '';
      updated[index].isFixed = false;
    }
    setSchema(updated);
  };

  const handleOptionOps = (index, op, payload) => {
    setSchema(prevSchema => {
      const newSchema = [...prevSchema];
      const field = { ...newSchema[index], options: [...(newSchema[index].options || [])] };
      if (op === 'add') field.options.push(payload || '');
      else if (op === 'remove') field.options.splice(payload, 1);
      else if (op === 'update') field.options[payload.idx] = payload.val;
      newSchema[index] = field;
      return newSchema;
    });
  };

  const handleSaveSchema = async () => {
    setLoading(true);
    try {
      const res = await axios.post('http://localhost:5000/api/manager/save-sheet-schema', {
        sheet_link: sheetLink, sheet_name: sheetName, schema, sheet_type: sheetType
      });
      if (res.data.success) {
        setHasExistingSchema(true);
        setIsEditMode(false);
        setBotConfirmed(true);
        alert(`✅ Rules Saved for ${sheetName}!`);
      }
    } catch (err) {
      alert("Error saving rules: " + (err.response?.data?.message || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleValidateSheet = async () => {
    setValidating(true);
    setValidationResults(null);
    try {
      const idMatch = sheetLink.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      const spreadsheetId = idMatch ? idMatch[1] : sheetLink;
      const res = await axios.post('http://localhost:5000/validate-and-format-sheet', {
        spreadsheet_id: spreadsheetId, tab_name: sheetName, sheet_type: sheetType, skip_formatting: false
      });
      if (res.data.success) {
        setValidationResults(res.data);
      }
    } catch (err) {
      alert(`Validation Failed for ${sheetName}: ` + (err.response?.data?.message || err.message));
    } finally {
      setValidating(false);
    }
  };

  const fieldTypes = [
    { value: 'text', label: 'Text' }, { value: 'number', label: 'Number' },
    { value: 'age', label: 'Age' }, { value: 'options', label: 'Dropdown Selection' },
    { value: 'date', label: 'Date (DD/MM/YYYY)' }, { value: 'phone_number', label: 'Mobile Number (10-digit)' },
    { value: 'pincode', label: 'Pincode' }, { value: 'aadhar', label: 'Aadhar Number' },
    { value: 'pan', label: 'PAN Card' }
  ];

  if (loading) return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-6 flex justify-center items-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mr-3"></div>
      <p className="text-gray-500 font-bold">Loading {sheetName}...</p>
    </div>
  );

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-6 transition-all hover:shadow-md">
      {/* SHEET HEADER */}
      <div className="bg-gray-50 p-4 border-b border-gray-200 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-100 text-indigo-700 w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold">
            📄
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-800">{sheetName}</h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-gray-400 uppercase tracking-wider">Status:</span>
              {hasExistingSchema ? (
                <span className="text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded">configured</span>
              ) : (
                <span className="text-orange-500 font-bold bg-orange-50 px-2 py-0.5 rounded">setup needed</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          {!isEditMode && (
            <button onClick={() => setIsEditMode(true)} className="px-4 py-2 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-xs">
              ⚙️ Configure
            </button>
          )}

          {!isEditMode && (
            <button
              onClick={handleValidateSheet}
              disabled={validating}
              className="bg-indigo-600 text-white font-bold text-xs px-4 py-2 rounded-lg shadow-sm hover:bg-indigo-700 transition-all disabled:opacity-70 disabled:cursor-wait flex items-center gap-2"
            >
              {validating ? (
                <>
                  <div className="animate-spin h-3 w-3 border-2 border-indigo-200 border-t-white rounded-full"></div>
                  <span>Checking...</span>
                </>
              ) : (
                <>⚡ Validate</>
              )}
            </button>
          )}
        </div>
      </div>

      <div className="p-6">
        {/* EDIT MODE */}
        {isEditMode ? (
          <div className="space-y-6 animate-fadeIn">
            {/* Rules Editor */}
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="bg-gray-50 p-3 border-b border-gray-100"><h4 className="font-bold text-gray-700 text-sm">Define Column Rules</h4></div>
              <div className="p-4 bg-gray-50/50">
                {schema.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">No columns found. Ensure Row 1 has headers.</div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                    {schema.map((field, i) => (
                      <div key={i} className="bg-white border border-gray-200 rounded p-2 shadow-sm flex flex-col gap-1.5">
                        <div className="flex justify-between items-start">
                          <div className="font-bold text-gray-800 text-sm truncate w-full" title={field.name}>{field.name}</div>
                          <span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-1 rounded">Col {i + 1}</span>
                        </div>

                        <select value={field.type} onChange={e => handleFieldChange(i, 'type', e.target.value)} className="w-full bg-white border border-gray-200 rounded px-2 py-1 text-xs font-semibold focus:ring-1 focus:ring-indigo-500">
                          {fieldTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>

                        <div className="flex items-center justify-between mt-1">
                          <label className="flex items-center gap-1 cursor-pointer select-none">
                            <input type="checkbox" checked={field.required} onChange={e => handleFieldChange(i, 'required', e.target.checked)} className="w-3 h-3 rounded border-gray-300 text-indigo-600" />
                            <span className="text-xs font-bold text-gray-600">Required</span>
                          </label>
                          {(field.type === 'text' || field.type === 'number') && (
                            <input type="number" value={field.length} onChange={e => handleFieldChange(i, 'length', e.target.value)} className="w-20 px-1 py-0.5 text-xs border border-gray-200 rounded text-center" placeholder="Len" />
                          )}
                        </div>

                        {field.type === 'options' && (
                          <div className="mt-1 bg-gray-50 p-1.5 rounded border border-gray-100">
                            <div className="flex flex-wrap gap-1 mb-1">
                              {field.options.map((opt, optIdx) => (
                                <span key={optIdx} className="bg-white border border-gray-200 text-gray-600 rounded px-1 text-[10px] flex items-center gap-1">
                                  {opt} <button onClick={() => handleOptionOps(i, 'remove', optIdx)} className="text-red-400 hover:text-red-600 font-bold">×</button>
                                </span>
                              ))}
                            </div>
                            <div className="flex gap-1">
                              <input onKeyDown={e => { if (e.key === 'Enter' && e.target.value.trim()) { handleOptionOps(i, 'add', e.target.value.trim()); e.target.value = ''; } }} placeholder="Add option.." className="flex-1 border border-gray-200 rounded px-1.5 py-0.5 text-[10px]" />
                              <button onClick={e => { const inp = e.target.previousElementSibling; if (inp.value.trim()) { handleOptionOps(i, 'add', inp.value.trim()); inp.value = ''; } }} className="bg-indigo-100 text-indigo-600 px-1.5 rounded text-[10px] font-bold">+</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="bg-gray-50 p-3 border-t border-gray-200 flex justify-end gap-3">
                <button onClick={() => setIsEditMode(false)} className="text-gray-500 font-bold text-xs hover:text-gray-700">Cancel</button>
                <button onClick={handleSaveSchema} disabled={!botConfirmed} className={`px-4 py-2 rounded text-xs font-bold shadow-sm ${!botConfirmed ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>Save Rules</button>
              </div>
            </div>
          </div>
        ) : (
          /* DASHBOARD MODE */
          <div className="animate-fadeIn">
            {validationResults && (
              <div className={`rounded border mb-4 ${validationResults.error_cells?.length > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
                <div className={`p-3 flex items-center gap-3 ${validationResults.error_cells?.length > 0 ? 'text-red-800' : 'text-green-800'}`}>
                  <div className={`p-1.5 rounded-full ${validationResults.error_cells?.length > 0 ? 'bg-red-200' : 'bg-green-200'}`}>
                    <span className="text-sm">{validationResults.error_cells?.length > 0 ? '❌' : '✅'}</span>
                  </div>
                  <div>
                    <h3 className="font-bold text-sm">{validationResults.message}</h3>
                    {validationResults.error_cells?.length > 0 ? (
                      <p className="opacity-80 text-xs">Found {validationResults.error_cells.length} cells violating rules.</p>
                    ) : (
                      <p className="opacity-80 text-xs">All data is valid.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {schema.map((f, i) => (
                <div key={i} className="bg-gray-50 p-2 rounded border border-gray-100">
                  <div className="text-[9px] font-bold text-gray-400 uppercase">Col {i + 1}</div>
                  <div className="font-bold text-gray-700 text-xs truncate" title={f.name}>{f.name}</div>
                  <div className="flex gap-1 mt-1">
                    <span className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 rounded">{f.type}</span>
                    {f.required && <span className="bg-red-100 text-red-600 text-[10px] px-1.5 rounded">*Req</span>}
                  </div>
                </div>
              ))}
              {schema.length === 0 && <span className="text-gray-400 text-xs italic p-2">No rules configured.</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// MAIN VALIDATION CONTAINER
// ------------------------------------------------------------------
function SheetValidationManager({ sheetName, sheetLink, sheetType, onComplete }) {
  const [tabs, setTabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Global Bot State
  const [botEmail, setBotEmail] = useState('');
  const [botConfirmed, setBotConfirmed] = useState(false);

  useEffect(() => {
    // Fetch Bot Email
    axios.get('http://localhost:5000/api/system/bot-email')
      .then(res => setBotEmail(res.data.email || ''))
      .catch(err => console.error(err));

    if (sheetLink) {
      setLoading(true);
      setError(null);
      console.log("Requesting tabs for:", sheetLink);
      axios.post('http://localhost:5000/api/manager/list-sheets', { sheet_link: sheetLink })
        .then(res => {
          if (res.data.success) {
            const foundTabs = res.data.tabs || [];
            setTabs(foundTabs);
          } else {
            setError("Server returned success=false");
          }
        })
        .catch(err => {
          console.error("Could not fetch tabs:", err);
          setError(err.message || "Failed to load tabs");
          // Fallback to just the assigned sheet name if listing fails, but keep error visible
          setTabs([sheetName]);
        })
        .finally(() => setLoading(false));
    }
  }, [sheetLink, sheetName]);

  return (
    <div className="max-w-6xl mx-auto font-sans pb-20">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-800">Validation Manager</h2>
          <div className="flex items-center gap-2 text-sm mt-1">
            <span className="text-gray-500">Spreadsheet:</span>
            <a href={sheetLink} target="_blank" rel="noreferrer" className="text-indigo-600 font-bold hover:underline truncate max-w-md block">{sheetLink}</a>
          </div>
        </div>
        <button onClick={onComplete} className="px-6 py-2 bg-gray-800 text-white font-bold rounded-lg hover:bg-gray-900 shadow-lg">Exit Manager</button>
      </div>

      {/* GLOBAL BOT PERMISSION */}
      <div className="max-w-md bg-blue-50 p-6 rounded-lg border border-blue-100 mb-8 animate-fadeIn text-left">
        <p className="text-sm text-blue-900 font-bold mb-2">Bot Service Email (Must be Editor):</p>

        <div className="flex gap-2 mb-3">
          <input
            readOnly
            value={botEmail || 'Loading...'}
            className="flex-1 bg-white border border-blue-200 text-gray-600 text-sm px-3 py-2 rounded focus:outline-none focus:border-blue-400 font-mono"
          />
          <button
            onClick={() => { navigator.clipboard.writeText(botEmail); alert('Copied!'); }}
            className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded shadow-sm transition-colors text-sm"
          >
            Copy
          </button>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none justify-start">
          <input
            type="checkbox"
            checked={botConfirmed}
            onChange={e => setBotConfirmed(e.target.checked)}
            className="w-5 h-5 text-blue-600 rounded border-blue-300 focus:ring-blue-500"
          />
          <span className="text-sm font-bold text-blue-800">I have shared the sheet with this email.</span>
        </label>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-20 text-gray-500">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
          <p>Scanning Spreadsheet...</p>
        </div>
      ) : (
        <div className="animate-slideUp">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6 flex items-center gap-2">
              <span>⚠️ Warning: Could not auto-detect tabs ({error}). Showing default assigned sheet.</span>
            </div>
          )}

          {tabs.length === 0 ? (
            <div className="text-center p-10 bg-gray-50 rounded-xl border border-dashed border-gray-300">
              <p className="text-gray-500">No sheets found.</p>
            </div>
          ) : (
            tabs.map(tab => (
              <SingleSheetValidation
                key={tab}
                sheetName={tab}
                sheetLink={sheetLink}
                sheetType={sheetType}
                botEmail={botEmail}
                botConfirmed={botConfirmed}
                setBotConfirmed={setBotConfirmed}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// VALIDATION MANAGE PAGE
// ------------------------------------------------------------------
function ValidationManagePage({ tasks }) {
  const [selectedSheet, setSelectedSheet] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('New');
  const [showArchived, setShowArchived] = useState(false);

  // Group tasks by unique sheet (sheetName + sheetType)
  const uniqueSheets = useMemo(() => {
    const sheetMap = new Map();
    tasks.forEach(task => {
      const key = `${task.sheetName}_${task.sheetType}`;
      if (!sheetMap.has(key)) {
        sheetMap.set(key, {
          sheetName: task.sheetName,
          sheetType: task.sheetType,
          link: task.link,
          assignedCount: 1
        });
      } else {
        sheetMap.get(key).assignedCount++;
      }
    });
    return Array.from(sheetMap.values());
  }, [tasks]);

  // Filter sheets by search query, type, and archived status
  const filteredSheets = useMemo(() => {
    let filtered = uniqueSheets;

    // Filter by type
    filtered = filtered.filter(sheet => sheet.sheetType === filterType);

    // Filter by archived status
    filtered = filtered.filter(sheet => {
      const sheetTasks = tasks.filter(t => t.sheetName === sheet.sheetName && t.sheetType === sheet.sheetType);
      const isArchived = sheetTasks.some(t => t.isArchived);
      return showArchived ? isArchived : !isArchived;
    });

    // Filter by search query
    if (searchQuery.trim()) {
      filtered = filtered.filter(sheet =>
        sheet.sheetName.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered;
  }, [uniqueSheets, searchQuery, filterType, showArchived, tasks]);

  // Group by sheet type (will only have one group now due to filterType)
  const groupedSheets = useMemo(() => {
    const groups = {};
    filteredSheets.forEach(sheet => {
      if (!groups[sheet.sheetType]) {
        groups[sheet.sheetType] = [];
      }
      groups[sheet.sheetType].push(sheet);
    });
    return groups;
  }, [filteredSheets]);

  const handleValidationComplete = () => {
    setSelectedSheet(null);
  };

  // If a sheet is selected, show the validation manager
  if (selectedSheet) {
    return (
      <SheetValidationManager
        sheetName={selectedSheet.sheetName}
        sheetLink={selectedSheet.link}
        sheetType={selectedSheet.sheetType}
        onComplete={handleValidationComplete}
      />
    );
  }

  // Otherwise, show the sheet selection list
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h2 className="text-3xl font-bold text-gray-800 mb-2">Sheet Validation Manager</h2>
        <p className="text-gray-600">Select a sheet to configure or update validation rules</p>
      </div>

      {/* Type Filter Buttons */}
      <div className="flex bg-gray-100 p-1.5 rounded-full self-start md:self-center">
        {['New', 'Daily', 'Weekly', 'Fortnightly', 'Monthly'].map(type => (
          <button
            key={type}
            onClick={() => setFilterType(type)}
            className={`px-6 py-2 mr-0.5 ml-0.5 rounded-full text-sm font-bold transition-all shadow-sm ${filterType === type
              ? 'bg-indigo-600 text-white'
              : 'bg-white text-gray-500 hover:text-gray-800'
              }`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Main Control Area */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">

        {/* Top Row: Search & Filters */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-8 border-b border-gray-100 pb-6">
          <div className="w-full md:w-96">
            <div className="relative w-full">
              <input
                placeholder="🔍 Search Sheet Name..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-4 pr-4 py-2.5 rounded-full border text-sm focus:outline-none transition-all border-gray-300 bg-gray-50 focus:ring-2 focus:ring-gray-400"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 cursor-pointer select-none bg-gray-50 px-4 py-2 rounded-full border border-gray-200 hover:bg-gray-100 transition-colors">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={e => setShowArchived(e.target.checked)}
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
              />
              <span className={`text-sm font-bold ${showArchived ? 'text-indigo-600' : 'text-gray-600'}`}>
                📦 Show Archived
              </span>
            </label>
          </div>
        </div>

        {/* Sheet List */}
        {filteredSheets.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-gray-400 text-lg">No {filterType} sheets found{searchQuery && ' matching your search'}</p>
            <p className="text-gray-500 text-sm mt-2">Add columns to your Google Sheet first, then return here to configure validation</p>
          </div>
        ) : (
          <div>
            <h3 className="text-lg font-bold text-gray-800 mb-4">{filterType} Sheets ({filteredSheets.length})</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSheets.map(sheet => (
                <div
                  key={`${sheet.sheetName}_${sheet.sheetType}`}
                  onClick={() => setSelectedSheet(sheet)}
                  className="border border-gray-200 rounded-lg p-4 hover:border-indigo-500 hover:shadow-md transition-all cursor-pointer group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-bold text-gray-800 group-hover:text-indigo-600 transition-colors line-clamp-2">
                      {sheet.sheetName}
                    </h4>
                    <span className="ml-2 text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      🔍
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span className="bg-gray-100 px-2 py-1 rounded">
                      {sheet.assignedCount} assigned
                    </span>
                    <span className="text-indigo-600 font-medium group-hover:underline">
                      Configure →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
