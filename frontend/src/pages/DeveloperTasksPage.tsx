/**
 * DeveloperTasksPage — Internal developer task tracker.
 * Route: /developer
 * Docs: ../../../docs/PAGES.md#developertaskspagetsx
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  IconButton,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Tab,
  Tabs,
  useTheme,
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircle as CheckCircleIcon,
  RadioButtonUnchecked as RadioButtonUncheckedIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
} from '@mui/icons-material';
import axios from 'axios';
import toast from 'react-hot-toast';
import GeocodeIssuePanel from '../components/developer/GeocodeIssuePanel';
import LiminalityCommandsGuide from '../components/developer/LiminalityCommandsGuide';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

function DeveloperTasksPage() {
  const theme = useTheme();
  const [searchParams, setSearchParams] = useSearchParams();
  const voiceTab = searchParams.get('tab') === 'voice';
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [editTaskOpen, setEditTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskPriorityDots, setTaskPriorityDots] = useState(1);

  // Load tasks from API on mount
  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_URL}/developer-tasks`);
      setTasks(response.data || []);
    } catch (error) {
      console.error('Error loading tasks:', error);
      if (error.code === 'ERR_NETWORK') {
        toast.error(
          `Cannot reach API at ${API_URL}. Start the backend (e.g. npm run dev in /backend) and ensure it is listening on port 4000.`
        );
      } else {
        toast.error('Failed to load tasks');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddTask = async () => {
    if (!taskTitle.trim()) {
      toast.error('Please enter a task title');
      return;
    }

    try {
      const response = await axios.post(`${API_URL}/developer-tasks`, {
        title: taskTitle.trim(),
        description: taskDescription.trim() || '',
        priorityDots: taskPriorityDots,
      });

      setTaskTitle('');
      setTaskDescription('');
      setTaskPriorityDots(1);
      setAddTaskOpen(false);
      toast.success('Task added');
      fetchTasks(); // Refresh tasks
    } catch (error) {
      console.error('Error adding task:', error);
      if (error.code === 'ERR_NETWORK') {
        toast.error(
          `Cannot reach API at ${API_URL}. Start the backend (e.g. npm run dev in /backend) on port 4000.`
        );
      } else {
        toast.error('Failed to add task');
      }
    }
  };

  const handleEditTask = async () => {
    if (!taskTitle.trim()) {
      toast.error('Please enter a task title');
      return;
    }

    try {
      await axios.patch(`${API_URL}/developer-tasks/${editingTask.id}`, {
        title: taskTitle.trim(),
        description: taskDescription.trim() || '',
        priorityDots: taskPriorityDots,
      });

      setTaskTitle('');
      setTaskDescription('');
      setTaskPriorityDots(1);
      setEditingTask(null);
      setEditTaskOpen(false);
      toast.success('Task updated');
      fetchTasks(); // Refresh tasks
    } catch (error) {
      console.error('Error updating task:', error);
      if (error.code === 'ERR_NETWORK') {
        toast.error(
          `Cannot reach API at ${API_URL}. Start the backend (e.g. npm run dev in /backend) on port 4000.`
        );
      } else {
        toast.error('Failed to update task');
      }
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (window.confirm('Are you sure you want to delete this task?')) {
      try {
        await axios.delete(`${API_URL}/developer-tasks/${taskId}`);
        toast.success('Task deleted');
        fetchTasks(); // Refresh tasks
      } catch (error) {
        console.error('Error deleting task:', error);
        if (error.code === 'ERR_NETWORK') {
          toast.error(
            `Cannot reach API at ${API_URL}. Start the backend (e.g. npm run dev in /backend) on port 4000.`
          );
        } else {
          toast.error('Failed to delete task');
        }
      }
    }
  };

  const handleToggleComplete = async (taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    try {
      await axios.patch(`${API_URL}/developer-tasks/${taskId}`, {
        completed: !task.completed,
      });
      fetchTasks(); // Refresh tasks
    } catch (error) {
      console.error('Error toggling task completion:', error);
      if (error.code === 'ERR_NETWORK') {
        toast.error(
          `Cannot reach API at ${API_URL}. Start the backend (e.g. npm run dev in /backend) on port 4000.`
        );
      } else {
        toast.error('Failed to update task');
      }
    }
  };

  const handleEditClick = (task) => {
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskDescription(task.description || '');
    setTaskPriorityDots([1, 2, 3].includes(Number(task.priorityDots)) ? Number(task.priorityDots) : 1);
    setEditTaskOpen(true);
  };

  const handleAddClick = () => {
    setTaskTitle('');
    setTaskDescription('');
    setTaskPriorityDots(1);
    setAddTaskOpen(true);
  };

  const handleCloseAdd = () => {
    setTaskTitle('');
    setTaskDescription('');
    setTaskPriorityDots(1);
    setAddTaskOpen(false);
  };

  const handleCloseEdit = () => {
    setTaskTitle('');
    setTaskDescription('');
    setTaskPriorityDots(1);
    setEditingTask(null);
    setEditTaskOpen(false);
  };

  const renderPriorityDots = (task) => {
    const count = [1, 2, 3].includes(Number(task.priorityDots)) ? Number(task.priorityDots) : 1;
    return (
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
        {Array.from({ length: count }).map((_, i) => (
          <Box
            key={`${task.id}-dot-${i}`}
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: 'success.main',
            }}
          />
        ))}
      </Box>
    );
  };

  const incompleteTasks = tasks.filter((task) => !task.completed);
  const completedTasks = tasks.filter((task) => task.completed);

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 600 }}>
            {voiceTab ? 'Voice commands' : 'Developer Tasks'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {voiceTab
              ? 'What you can say to Liminality after the listen cue'
              : 'Track your development tasks and todos'}
          </Typography>
        </Box>
        {!voiceTab ? (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddClick}
            sx={{
              borderRadius: '8px',
              textTransform: 'none',
            }}
          >
            Add Task
          </Button>
        ) : null}
      </Box>

      <Tabs
        value={voiceTab ? 'voice' : 'tasks'}
        onChange={(_event, next) => {
          setSearchParams(next === 'voice' ? { tab: 'voice' } : {}, { replace: true });
        }}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="tasks" label="Tasks" sx={{ textTransform: 'none' }} />
        <Tab value="voice" label="Voice commands" sx={{ textTransform: 'none' }} />
      </Tabs>

      {voiceTab ? (
        <LiminalityCommandsGuide />
      ) : (
        <>
      <GeocodeIssuePanel />

      {/* Incomplete Tasks */}
      {incompleteTasks.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
            Active Tasks ({incompleteTasks.length})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {incompleteTasks.map((task) => (
              <Card
                key={task.id}
                sx={{
                  p: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  borderLeft: '3px solid #1976D2',
                  '&:hover': {
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                    transform: 'translateY(-2px)',
                    transition: 'all 0.2s',
                  },
                }}
              >
                <Checkbox
                  icon={<RadioButtonUncheckedIcon />}
                  checkedIcon={<CheckCircleIcon />}
                  checked={false}
                  onChange={() => handleToggleComplete(task.id)}
                  sx={{ color: 'primary.main' }}
                />

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                    {task.title}
                  </Typography>
                  <Box sx={{ mt: 0.75 }}>{renderPriorityDots(task)}</Box>
                  {task.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {task.description}
                    </Typography>
                  )}
                </Box>

                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <IconButton
                    size="small"
                    onClick={() => handleEditClick(task)}
                    sx={{ color: 'primary.main' }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDeleteTask(task.id)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Card>
            ))}
          </Box>
        </Box>
      )}

      {/* Completed Tasks */}
      {completedTasks.length > 0 && (
        <Box>
          <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
            Completed Tasks ({completedTasks.length})
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {completedTasks.map((task) => (
              <Card
                key={task.id}
                sx={{
                  p: 2,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  borderLeft: '3px solid #43A047',
                  opacity: 0.7,
                  '&:hover': {
                    opacity: 1,
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                    transform: 'translateY(-2px)',
                    transition: 'all 0.2s',
                  },
                }}
              >
                <Checkbox
                  icon={<RadioButtonUncheckedIcon />}
                  checkedIcon={<CheckCircleIcon />}
                  checked={true}
                  onChange={() => handleToggleComplete(task.id)}
                  sx={{ color: 'success.main' }}
                />

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="body1"
                    sx={{
                      fontWeight: 400,
                      textDecoration: 'line-through',
                    }}
                  >
                    {task.title}
                  </Typography>
                  <Box sx={{ mt: 0.75 }}>{renderPriorityDots(task)}</Box>
                  {task.description && (
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mt: 0.5, textDecoration: 'line-through' }}
                    >
                      {task.description}
                    </Typography>
                  )}
                </Box>

                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <IconButton
                    size="small"
                    onClick={() => handleEditClick(task)}
                    sx={{ color: 'primary.main' }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    color="error"
                    onClick={() => handleDeleteTask(task.id)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Card>
            ))}
          </Box>
        </Box>
      )}

      {/* Empty State */}
      {!loading && tasks.length === 0 && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No tasks yet. Click "Add Task" to get started.
          </Typography>
        </Paper>
      )}

      {/* Loading State */}
      {loading && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            Loading tasks...
          </Typography>
        </Paper>
      )}
        </>
      )}

      {/* Add Task Dialog */}
      <Dialog open={addTaskOpen} onClose={handleCloseAdd} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Task</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField
              label="Task Title"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              required
              fullWidth
              autoFocus
              placeholder="e.g., Fix bug in job archiving"
            />
            <TextField
              label="Description (optional)"
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              fullWidth
              multiline
              rows={3}
              placeholder="Add any additional details..."
            />
            <FormControl fullWidth>
              <InputLabel id="add-priority-dots-label">Priority Dots</InputLabel>
              <Select
                labelId="add-priority-dots-label"
                value={taskPriorityDots}
                label="Priority Dots"
                onChange={(e) => setTaskPriorityDots(Number(e.target.value))}
              >
                <MenuItem value={1}>1 dot</MenuItem>
                <MenuItem value={2}>2 dots</MenuItem>
                <MenuItem value={3}>3 dots</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAdd}>Cancel</Button>
          <Button onClick={handleAddTask} variant="contained">
            Add Task
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit Task Dialog */}
      <Dialog open={editTaskOpen} onClose={handleCloseEdit} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Task</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField
              label="Task Title"
              value={taskTitle}
              onChange={(e) => setTaskTitle(e.target.value)}
              required
              fullWidth
              autoFocus
            />
            <TextField
              label="Description (optional)"
              value={taskDescription}
              onChange={(e) => setTaskDescription(e.target.value)}
              fullWidth
              multiline
              rows={3}
            />
            <FormControl fullWidth>
              <InputLabel id="edit-priority-dots-label">Priority Dots</InputLabel>
              <Select
                labelId="edit-priority-dots-label"
                value={taskPriorityDots}
                label="Priority Dots"
                onChange={(e) => setTaskPriorityDots(Number(e.target.value))}
              >
                <MenuItem value={1}>1 dot</MenuItem>
                <MenuItem value={2}>2 dots</MenuItem>
                <MenuItem value={3}>3 dots</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseEdit}>Cancel</Button>
          <Button onClick={handleEditTask} variant="contained">
            Save Changes
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default DeveloperTasksPage;

