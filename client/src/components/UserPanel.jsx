import React, { useEffect, useState } from 'react';
import axios from 'axios';

export default function UserPanel({ currentUser }) {
    const [tasks, setTasks] = useState([]);
    const [view, setView] = useState('active'); // 'active', 'completed', 'archive'
    const [activeTab, setActiveTab] = useState('New'); // 'New', 'Daily', 'Weekly', 'Monthly'
    const [loading, setLoading] = useState(true);
    const [validating, setValidating] = useState({});
    const [validationResults, setValidationResults] = useState({});
    const [submitTimers, setSubmitTimers] = useState({}); // { taskId: { countdown: 15, ready: false } }
    const [timerIntervals, setTimerIntervals] = useState({}); // Store interval IDs

    useEffect(() => {
        if (currentUser?.id) {
            fetchTasks();
            // Auto-refresh every 5 seconds to catch archived tasks
            const interval = setInterval(() => {
                fetchTasks();
            }, 5000);
            return () => clearInterval(interval);
        }
    }, [currentUser]);

    // Cleanup timer intervals on unmount
    useEffect(() => {
        return () => {
            Object.values(timerIntervals).forEach(intervalId => clearInterval(intervalId));
        };
    }, [timerIntervals]);

    const fetchTasks = async () => {
        try {
            const res = await axios.post('http://localhost:5000/api/user/tasks', { userId: currentUser.id });
            setTasks(res.data);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    };

    // --- ACTIONS ---
    const markComplete = async (taskId) => {
        const timerState = submitTimers[taskId];

        // First press: Start the 15-second countdown
        if (!timerState || !timerState.ready) {
            // Clear any existing timer for this task
            if (timerIntervals[taskId]) {
                clearInterval(timerIntervals[taskId]);
            }

            // Initialize countdown at 15 seconds
            setSubmitTimers(prev => ({
                ...prev,
                [taskId]: { countdown: 15, ready: false }
            }));

            // Start countdown interval
            const intervalId = setInterval(() => {
                setSubmitTimers(prev => {
                    const current = prev[taskId];
                    if (!current) return prev;

                    const newCountdown = current.countdown - 1;

                    if (newCountdown <= 0) {
                        // Timer finished, mark as ready
                        clearInterval(intervalId);
                        setTimerIntervals(prev => {
                            const newIntervals = { ...prev };
                            delete newIntervals[taskId];
                            return newIntervals;
                        });
                        return {
                            ...prev,
                            [taskId]: { countdown: 0, ready: true }
                        };
                    }

                    return {
                        ...prev,
                        [taskId]: { countdown: newCountdown, ready: false }
                    };
                });
            }, 1000);

            // Store interval ID
            setTimerIntervals(prev => ({ ...prev, [taskId]: intervalId }));
            return;
        }

        // Second press: Actually submit (after timer is ready)
        if (!window.confirm("Confirm submission?")) return;

        // Clear timer state
        setSubmitTimers(prev => {
            const newTimers = { ...prev };
            delete newTimers[taskId];
            return newTimers;
        });

        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'Completed', isNil: false } : t));
        try { await axios.post('http://localhost:5000/api/user/complete', { taskId }); } catch (e) { fetchTasks(); }
    };

    const submitNil = async (taskId) => {
        if (!window.confirm("Submit Nil Report? This means you have no data to enter.")) return;
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'Completed', isNil: true } : t));
        try { await axios.post('http://localhost:5000/api/user/submit-nil', { taskId }); } catch (e) { fetchTasks(); }
    };

    const handleValidate = async (task) => {
        setValidating(prev => ({ ...prev, [task.id]: true }));
        setValidationResults(prev => ({ ...prev, [task.id]: null }));

        try {
            const idMatch = task.link.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            const spreadsheetId = idMatch ? idMatch[1] : task.link;

            // First, fetch the actual sheet tabs to get the correct tab name
            let tabName = task.name; // Default to task name
            try {
                const tabsRes = await axios.post('http://localhost:5000/api/manager/list-sheets', {
                    sheet_link: task.link
                });
                if (tabsRes.data.success && tabsRes.data.tabs && tabsRes.data.tabs.length > 0) {
                    // Use the first tab (backend fallback behavior)
                    tabName = tabsRes.data.tabs[0];
                    console.log(`Using tab name: "${tabName}" for validation`);
                }
            } catch (tabErr) {
                console.warn('Could not fetch tabs, using task name as fallback:', tabErr.message);
            }

            const res = await axios.post('http://localhost:5000/validate-and-format-sheet', {
                spreadsheet_id: spreadsheetId,
                tab_name: tabName,
                sheet_type: task.type || 'New',
                skip_formatting: false
            });

            if (res.data.success) {
                setValidationResults(prev => ({ ...prev, [task.id]: res.data }));
            }
        } catch (err) {
            alert(`Validation Failed for ${task.name}: ` + (err.response?.data?.message || err.message));
        } finally {
            setValidating(prev => ({ ...prev, [task.id]: false }));
        }
    };

    // --- FILTERING LOGIC (ACTIVE vs COMPLETED) ---
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Reset time to start of day for accurate comparison

    const getFilteredTasks = () => {
        return tasks.filter(t => {
            // 1. COMPLETED: All completed tasks
            if (view === 'completed') {
                return t.status === 'Completed';
            }

            // 2. ACTIVE: All pending tasks (regardless of due date)
            if (view === 'active') {
                return t.status === 'Pending';
            }

            return false;
        })
            // Finally Filter by TAB (New/Daily/Monthly)
            .filter(t => (t.type || 'New').toLowerCase() === activeTab.toLowerCase());
    };

    const displayedTasks = getFilteredTasks();

    return (
        <div className="flex h-screen bg-gray-100 -m-5">
            {/* Sidebar */}
            <div className="w-64 bg-gray-900 text-white flex flex-col p-4 fixed h-full z-10">
                <div className="mb-8 border-b border-gray-700 pb-4">
                    <h2 className="text-xl font-bold tracking-wide">Officer Portal</h2>
                    <p className="text-gray-400 text-xs mt-1 font-mono">{currentUser.name}</p>
                    <span className="text-[10px] bg-blue-900 text-blue-200 px-2 py-0.5 rounded mt-2 inline-block">
                        {currentUser.subdivision || 'General'}
                    </span>
                </div>

                <nav className="space-y-2">
                    <button onClick={() => setView('active')} className={`w-full text-left px-4 py-3 rounded font-medium transition-colors ${view === 'active' ? 'bg-indigo-600 shadow-lg text-white' : 'hover:bg-gray-800 text-gray-400'}`}>
                        🚀 Active Tasks
                    </button>
                    <button onClick={() => setView('completed')} className={`w-full text-left px-4 py-3 rounded font-medium transition-colors ${view === 'completed' ? 'bg-green-600 shadow-lg text-white' : 'hover:bg-gray-800 text-gray-400'}`}>
                        ✅ Completed
                    </button>
                </nav>
            </div>

            {/* Main Content */}
            <div className="flex-1 ml-64 p-8 overflow-y-auto h-full">
                <div className="max-w-6xl mx-auto">
                    {/* Header Section */}
                    <div className="flex justify-between items-end mb-6 border-b pb-4">
                        <div>
                            <h1 className="text-3xl font-bold text-gray-800 capitalize">
                                {view === 'active' && 'Current Tasks'}
                                {view === 'completed' && 'Submitted Reports'}
                            </h1>
                            <p className="text-gray-500 text-sm mt-1">
                                {view === 'active' && 'Tasks requiring your attention'}
                                {view === 'completed' && 'Tasks submitted successfully'}
                            </p>
                        </div>
                    </div>

                    {/* Category Tabs */}
                    <div className="flex gap-2 mb-8 bg-white p-1 rounded-full w-fit shadow-sm border">
                        {['New', 'Daily', 'Weekly', 'Fortnightly', 'Monthly'].map(tab => {
                            // Badge Logic
                            const count = tasks.filter(t =>
                                (t.type || 'New').toLowerCase() === tab.toLowerCase() && // Match Type
                                t.status === 'Pending' // Must be Pending
                            ).length;

                            return (
                                <button
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`relative px-6 py-2 rounded-full font-bold text-sm transition-all flex items-center gap-2 ${activeTab === tab ? 'bg-indigo-600 text-white shadow' : 'bg-transparent text-gray-500 hover:bg-gray-50'}`}
                                >
                                    {tab}
                                    {count > 0 && view === 'active' && (
                                        <span className={`flex items-center justify-center w-5 h-5 text-[10px] rounded-full font-bold ${activeTab === tab ? 'bg-white text-indigo-600' : 'bg-red-500 text-white'}`}>
                                            {count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {loading ? <p className="text-gray-500">Loading your dashboard...</p> : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {displayedTasks.length === 0 && (
                                <div className="col-span-3 text-center py-20 bg-white rounded-lg border border-dashed border-gray-300">
                                    <p className="text-gray-400 italic">No {view} records found in "{activeTab}".</p>
                                </div>
                            )}

                            {displayedTasks.map(task => (
                                <div key={task.id} className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 relative hover:shadow-md transition-shadow flex flex-col ${task.isNil ? 'bg-gray-50' : ''}`}>

                                    {/* Card Header */}
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="pr-2 flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <h3 className="font-bold text-gray-800 text-lg leading-tight line-clamp-1 flex-1" title={task.name}>{task.name}</h3>
                                                {/* Small Validate Button */}
                                                {view === 'active' && (
                                                    <button
                                                        onClick={() => handleValidate(task)}
                                                        disabled={validating[task.id]}
                                                        className="text-[10px] font-bold px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 transition-all disabled:opacity-70 disabled:cursor-wait flex items-center gap-1 whitespace-nowrap"
                                                    >
                                                        {validating[task.id] ? (
                                                            <>
                                                                <div className="animate-spin h-2 w-2 border border-indigo-200 border-t-white rounded-full"></div>
                                                                <span>...</span>
                                                            </>
                                                        ) : (
                                                            <>⚡ Validate</>
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                            {/* Hide due date only for "Daily" type tasks */}
                                            {task.type?.toLowerCase() !== 'daily' && (
                                                <p className={`text-xs mt-2 font-mono ${new Date(task.dueDate) < today && task.status === 'Pending' ? 'text-red-500 font-bold' : 'text-gray-500'}`}>
                                                    Due: {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : 'No Date'}
                                                </p>
                                            )}
                                            {/* Manager Name */}
                                            {task.managerName && (
                                                <p className="text-xs mt-1 text-gray-400">
                                                    👤 Assigned by: <span className="font-semibold">{task.managerName}</span>
                                                </p>
                                            )}
                                        </div>

                                        {/* Status Badge */}
                                        {task.isNil ? (
                                            <span className="bg-gray-200 text-gray-600 text-[10px] px-2 py-1 rounded font-bold whitespace-nowrap">NIL</span>
                                        ) : (
                                            <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded whitespace-nowrap ${task.status === 'Completed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                {task.status}
                                            </span>
                                        )}
                                    </div>

                                    {/* View Specific Logic */}
                                    <div className="mt-auto pt-4">

                                        {/* ACTIVE VIEW: Action Buttons */}
                                        {view === 'active' && (
                                            <div className="space-y-3">
                                                {/* Validation Results */}
                                                {validationResults[task.id] && (
                                                    <div className={`rounded border ${validationResults[task.id].error_cells?.length > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
                                                        <div className={`p-3 flex items-center gap-3 ${validationResults[task.id].error_cells?.length > 0 ? 'text-red-800' : 'text-green-800'}`}>
                                                            <div className={`p-1.5 rounded-full ${validationResults[task.id].error_cells?.length > 0 ? 'bg-red-200' : 'bg-green-200'}`}>
                                                                <span className="text-sm">{validationResults[task.id].error_cells?.length > 0 ? '❌' : '✅'}</span>
                                                            </div>
                                                            <div>
                                                                <h3 className="font-bold text-sm">{validationResults[task.id].message}</h3>
                                                                {validationResults[task.id].error_cells?.length > 0 ? (
                                                                    <p className="opacity-80 text-xs">Found {validationResults[task.id].error_cells.length} cells violating rules.</p>
                                                                ) : (
                                                                    <p className="opacity-80 text-xs">All data is valid.</p>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                <a href={task.link} target="_blank" rel="noopener noreferrer" className="block w-full text-center bg-blue-50 text-blue-600 font-bold py-2.5 rounded-lg text-sm hover:bg-blue-100 border border-blue-100 transition-colors">
                                                    Open Sheet
                                                </a>
                                                <div className={`flex ${task.allowNil ? 'flex-col gap-3' : 'gap-2'}`}>
                                                    <button
                                                        onClick={() => markComplete(task.id)}
                                                        className={`flex-1 font-bold py-2.5 rounded-lg text-sm transition-colors shadow-sm w-full ${submitTimers[task.id]?.ready
                                                            ? 'bg-green-600 text-white hover:bg-green-700'
                                                            : submitTimers[task.id]?.countdown > 0
                                                                ? 'bg-orange-500 text-white cursor-wait'
                                                                : 'bg-green-600 text-white hover:bg-green-700'
                                                            }`}
                                                        disabled={submitTimers[task.id]?.countdown > 0 && !submitTimers[task.id]?.ready}
                                                    >
                                                        {submitTimers[task.id]?.countdown > 0 && !submitTimers[task.id]?.ready
                                                            ? `Wait ${submitTimers[task.id].countdown}s...`
                                                            : submitTimers[task.id]?.ready
                                                                ? 'Press to Submit ✓'
                                                                : 'Done'
                                                        }
                                                    </button>
                                                    {task.allowNil && (
                                                        <button onClick={() => submitNil(task.id)} className="flex-1 bg-white text-red-600 border border-red-200 font-bold py-2.5 rounded-lg text-sm hover:bg-red-50 transition-colors w-full">
                                                            Nil
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* COMPLETED VIEW: Read Only */}
                                        {view === 'completed' && (
                                            <div>
                                                <div className="text-center py-2 border rounded-lg bg-green-50 text-green-700 text-xs font-bold mb-2">
                                                    Successfully Submitted
                                                </div>
                                                <a href={task.link} target="_blank" rel="noopener noreferrer" className="block w-full text-center text-gray-500 hover:text-blue-600 text-xs hover:underline mt-2">
                                                    View Sheet Again
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}