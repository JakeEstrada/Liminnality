/**
 * WebsitePage — Super-admin CMS for the customer-facing homepage.
 * Route: /website
 * APIs: GET/PUT /website, photo and project uploads
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  IconButton,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import {
  Add as AddIcon,
  ArrowDownward as ArrowDownIcon,
  ArrowUpward as ArrowUpIcon,
  Delete as DeleteIcon,
  PhotoCamera as PhotoIcon,
  Download as DownloadIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
} from '@mui/icons-material';
import axios from 'axios';
import toast from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

type WebsitePhoto = {
  id: string;
  alt?: string;
  originalName?: string;
  url: string;
};

type WebsiteProject = {
  id: string;
  slug?: string;
  title: string;
  description: string;
  visible: boolean;
  photos: WebsitePhoto[];
};

type WebsiteContent = {
  heroHeadline: string;
  heroSubheadline: string;
  heroCtaLabel: string;
  heroCtaUrl: string;
  aboutTitle: string;
  aboutBody: string;
  storyTitle: string;
  storyBody: string;
  quoteHeadline: string;
  heroPhotos: WebsitePhoto[];
  gallery: WebsitePhoto[];
  projects: WebsiteProject[];
};

const EMPTY: WebsiteContent = {
  heroHeadline: '',
  heroSubheadline: '',
  heroCtaLabel: '',
  heroCtaUrl: '',
  aboutTitle: '',
  aboutBody: '',
  storyTitle: '',
  storyBody: '',
  quoteHeadline: '',
  heroPhotos: [],
  gallery: [],
  projects: [],
};

function mediaSrc(url?: string) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_URL}${url}`;
}

function collectAllWebsitePhotos(content: WebsiteContent): WebsitePhoto[] {
  const seen = new Set<string>();
  const photos: WebsitePhoto[] = [];
  const add = (photo?: WebsitePhoto) => {
    const key = String(photo?.id || photo?.url || '').trim();
    if (!photo?.url || !key || seen.has(key)) return;
    seen.add(key);
    photos.push(photo);
  };
  content.heroPhotos.forEach(add);
  content.gallery.forEach(add);
  content.projects.forEach((project) => project.photos.forEach(add));
  return photos;
}

type SpecRow = { label: string; value: string };

const SPEC_FIELDS = [
  { key: 'post type', label: 'Post type' },
  { key: 'rail type', label: 'Rail type' },
  { key: 'rail system', label: 'Rail system' },
  { key: 'balustrade', label: 'Balustrade' },
  { key: 'treads', label: 'Treads' },
] as const;

function parseSpecRows(description: string): SpecRow[] {
  return (description || '')
    .split(/\s*\|\|?\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const i = s.indexOf(':');
      if (i > 0 && i < 32) {
        return { label: s.slice(0, i).trim(), value: s.slice(i + 1).trim() };
      }
      const value = s;
      const lower = value.toLowerCase();
      let label = '';
      if (/tread/.test(lower)) label = 'Treads';
      else if (/riser/.test(lower)) label = 'Risers';
      else if (/skirt/.test(lower)) label = 'Skirting';
      return { label, value };
    })
    .filter((row) => row.value);
}

function parseDescriptionSpecs(description: string) {
  const known: Record<string, string> = {
    'post type': '',
    'rail type': '',
    'rail system': '',
    balustrade: '',
    treads: '',
  };
  const extra: SpecRow[] = [];
  for (const row of parseSpecRows(description)) {
    const key = row.label.trim().toLowerCase();
    if (key && key in known && !known[key]) {
      known[key] = row.value;
    } else if (!row.label && /tread/i.test(row.value) && !known.treads) {
      known.treads = row.value;
    } else if (!row.label && !known['post type']) {
      known['post type'] = row.value;
    } else {
      extra.push(row);
    }
  }
  return { known, extra };
}

function specsToDescription(known: Record<string, string>, extra: SpecRow[]) {
  const parts: string[] = [];
  for (const field of SPEC_FIELDS) {
    const value = String(known[field.key] || '').trim();
    if (value) parts.push(`${field.label}: ${value}`);
  }
  for (const row of extra) {
    const value = String(row.value || '').trim();
    if (!value) continue;
    const label = String(row.label || '').trim();
    parts.push(label ? `${label}: ${value}` : value);
  }
  return parts.join(' || ');
}

function SpecPreview({ description }: { description: string }) {
  const rows = parseSpecRows(description);
  if (!rows.length) return null;
  return (
    <Box sx={{ display: 'grid', gap: 0.25, mt: 0.5 }}>
      {rows.map((row, i) => (
        <Box key={`${row.label}-${i}`} sx={{ display: 'grid', gridTemplateColumns: row.label ? 'auto 1fr' : '1fr', gap: 0.75, alignItems: 'baseline' }}>
          {row.label ? (
            <Typography variant="caption" sx={{ letterSpacing: '0.08em', textTransform: 'uppercase', color: 'text.secondary', whiteSpace: 'nowrap' }}>
              {row.label}
            </Typography>
          ) : null}
          <Typography variant="body2">{row.value}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function ProjectSpecFields({
  projectId,
  description,
  onDescriptionChange,
}: {
  projectId: string;
  description: string;
  onDescriptionChange: (description: string) => void;
}) {
  const [known, setKnown] = useState(() => parseDescriptionSpecs(description).known);
  const [extra, setExtra] = useState(() => parseDescriptionSpecs(description).extra);

  useEffect(() => {
    const next = parseDescriptionSpecs(description);
    setKnown(next.known);
    setExtra(next.extra);
    // Reset when switching projects only. Re-parsing on each keystroke ate spaces.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- description
  }, [projectId]);

  const emit = (nextKnown: Record<string, string>, nextExtra: SpecRow[]) => {
    onDescriptionChange(specsToDescription(nextKnown, nextExtra));
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {SPEC_FIELDS.map((field) => (
        <TextField
          key={field.key}
          label={field.label}
          size="small"
          value={known[field.key] || ''}
          onChange={(e) => {
            const nextKnown = { ...known, [field.key]: e.target.value };
            setKnown(nextKnown);
            emit(nextKnown, extra);
          }}
        />
      ))}
      {extra.map((row, extraIndex) => (
        <Box key={`extra-${extraIndex}`} sx={{ display: 'flex', gap: 1 }}>
          <TextField
            label="Label"
            size="small"
            value={row.label}
            onChange={(e) => {
              const nextExtra = extra.map((item, i) => (i === extraIndex ? { ...item, label: e.target.value } : item));
              setExtra(nextExtra);
              emit(known, nextExtra);
            }}
            sx={{ width: 140, flexShrink: 0 }}
          />
          <TextField
            label="Value"
            size="small"
            value={row.value}
            onChange={(e) => {
              const nextExtra = extra.map((item, i) => (i === extraIndex ? { ...item, value: e.target.value } : item));
              setExtra(nextExtra);
              emit(known, nextExtra);
            }}
            fullWidth
          />
        </Box>
      ))}
      <Button
        size="small"
        onClick={() => setExtra((prev) => [...prev, { label: '', value: '' }])}
        sx={{ alignSelf: 'flex-start', textTransform: 'none', px: 0 }}
      >
        Add spec
      </Button>
    </Box>
  );
}

function PhotoTile({
  photo,
  onDelete,
  onMoveUp,
  onMoveDown,
  disableUp,
  disableDown,
}: {
  photo: WebsitePhoto;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  disableUp?: boolean;
  disableDown?: boolean;
}) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: 140,
        height: 140,
        borderRadius: 1,
        overflow: 'hidden',
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'action.hover',
      }}
    >
      <Box
        component="img"
        src={mediaSrc(photo.url)}
        alt={photo.alt || photo.originalName || 'Photo'}
        sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
      <Box sx={{ position: 'absolute', top: 4, right: 4, display: 'flex', gap: 0.25 }}>
        {onMoveUp ? (
          <IconButton size="small" onClick={onMoveUp} disabled={disableUp} sx={tileBtnSx} aria-label="Move up">
            <ArrowUpIcon sx={{ fontSize: 16 }} />
          </IconButton>
        ) : null}
        {onMoveDown ? (
          <IconButton size="small" onClick={onMoveDown} disabled={disableDown} sx={tileBtnSx} aria-label="Move down">
            <ArrowDownIcon sx={{ fontSize: 16 }} />
          </IconButton>
        ) : null}
        <IconButton size="small" onClick={onDelete} sx={tileBtnSx} aria-label="Remove photo">
          <DeleteIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>
    </Box>
  );
}

const tileBtnSx = {
  width: 24,
  height: 24,
  bgcolor: 'rgba(0,0,0,0.55)',
  color: '#fff',
  '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
  '&.Mui-disabled': { color: 'rgba(255,255,255,0.4)', bgcolor: 'rgba(0,0,0,0.35)' },
};

function WebsitePage() {
  const theme = useTheme();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadingSlideshow, setDownloadingSlideshow] = useState(false);
  const [content, setContent] = useState<WebsiteContent>(EMPTY);
  const heroInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const projectPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const [projectPhotoTarget, setProjectPhotoTarget] = useState<string | null>(null);

  const applyContent = useCallback((data: Partial<WebsiteContent> & { projects?: Array<WebsiteProject & { photo?: WebsitePhoto | null }> }) => {
    setContent({
      ...EMPTY,
      ...data,
      heroPhotos: Array.isArray(data.heroPhotos) ? data.heroPhotos : [],
      gallery: Array.isArray(data.gallery) ? data.gallery : [],
      projects: Array.isArray(data.projects)
        ? data.projects.map((project) => ({
            id: project.id,
            slug: project.slug || '',
            title: project.title || '',
            description: project.description || '',
            visible: project.visible !== false,
            photos: Array.isArray(project.photos)
              ? project.photos
              : project.photo
                ? [project.photo]
                : [],
          }))
        : [],
    });
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await axios.get(`${API_URL}/website`);
      applyContent(data);
    } catch (error) {
      console.error('Error loading website content:', error);
      toast.error('Failed to load website content');
    } finally {
      setLoading(false);
    }
  }, [applyContent]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleField = (field: keyof WebsiteContent, value: string) => {
    setContent((prev) => ({ ...prev, [field]: value }));
  };

  const slideshowPhotoCount = collectAllWebsitePhotos(content).length;

  const handleDownloadSlideshow = async () => {
    if (!slideshowPhotoCount || downloadingSlideshow) return;
    setDownloadingSlideshow(true);
    try {
      const { data } = await axios.get(`${API_URL}/website/photos/slideshow-zip`, {
        responseType: 'blob',
        timeout: 10 * 60 * 1000,
      });
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/zip' });
      if (blob.type && blob.type.includes('json')) {
        throw new Error('Download failed');
      }
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = 'website-slideshow.zip';
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      toast.success(`Downloaded ${slideshowPhotoCount} photos in random order`);
    } catch (error) {
      console.error('Error downloading slideshow zip:', error);
      toast.error('Failed to download photos');
    } finally {
      setDownloadingSlideshow(false);
    }
  };

  const handleSaveCopy = async () => {
    try {
      setSaving(true);
      const { data } = await axios.put(`${API_URL}/website`, {
        heroHeadline: content.heroHeadline,
        heroSubheadline: content.heroSubheadline,
        heroCtaLabel: content.heroCtaLabel,
        heroCtaUrl: content.heroCtaUrl,
        aboutTitle: content.aboutTitle,
        aboutBody: content.aboutBody,
        storyTitle: content.storyTitle,
        storyBody: content.storyBody,
        quoteHeadline: content.quoteHeadline,
      });
      applyContent(data);
      toast.success('Homepage copy saved');
    } catch (error) {
      console.error('Error saving website content:', error);
      toast.error('Failed to save copy');
    } finally {
      setSaving(false);
    }
  };

  const uploadPhotos = async (endpoint: string, files: FileList | File[] | null) => {
    const list = [...(files || [])].filter(Boolean);
    if (!list.length) return;
    setUploading(true);
    try {
      let latest = content;
      for (const file of list) {
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name}: images only`);
          continue;
        }
        const formData = new FormData();
        formData.append('file', file);
        const { data } = await axios.post(`${API_URL}${endpoint}`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        latest = data;
        applyContent(data);
      }
      if (latest) toast.success(list.length === 1 ? 'Photo added' : 'Photos added');
    } catch (error) {
      console.error('Error uploading website photo:', error);
      toast.error('Failed to upload photo');
    } finally {
      setUploading(false);
    }
  };

  const deletePhoto = async (endpoint: string) => {
    try {
      const { data } = await axios.delete(`${API_URL}${endpoint}`);
      applyContent(data);
    } catch (error) {
      console.error('Error deleting website photo:', error);
      toast.error('Failed to remove photo');
    }
  };

  const moveItem = async (section: 'hero' | 'gallery' | 'projects', index: number, direction: -1 | 1) => {
    const list =
      section === 'hero' ? content.heroPhotos : section === 'gallery' ? content.gallery : content.projects;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= list.length) return;
    const ids = list.map((row) => row.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(nextIndex, 0, moved);
    try {
      const { data } = await axios.patch(`${API_URL}/website/order`, { section, ids });
      applyContent(data);
    } catch (error) {
      console.error('Error reordering website items:', error);
      toast.error('Failed to reorder');
    }
  };

  const addProject = async () => {
    try {
      const { data } = await axios.post(`${API_URL}/website/projects`, {
        title: 'New project',
        description: '',
      });
      applyContent(data);
    } catch (error) {
      console.error('Error adding project:', error);
      toast.error('Failed to add project');
    }
  };

  const setProjectDescription = (projectId: string, description: string) => {
    setContent((prev) => ({
      ...prev,
      projects: prev.projects.map((row) => (row.id === projectId ? { ...row, description } : row)),
    }));
  };

  const toggleProjectVisible = async (project: WebsiteProject) => {
    try {
      const { data } = await axios.patch(`${API_URL}/website/projects/${project.id}`, {
        visible: !project.visible,
      });
      applyContent(data);
    } catch (error) {
      console.error('Error toggling project visibility:', error);
      toast.error('Failed to update visibility');
    }
  };

  const saveProject = async (project: WebsiteProject) => {
    try {
      const { known, extra } = parseDescriptionSpecs(project.description);
      const { data } = await axios.patch(`${API_URL}/website/projects/${project.id}`, {
        title: project.title,
        description: specsToDescription(known, extra),
      });
      applyContent(data);
      toast.success('Project saved');
    } catch (error) {
      console.error('Error saving project:', error);
      toast.error('Failed to save project');
    }
  };

  const removeProject = async (projectId: string) => {
    try {
      const { data } = await axios.delete(`${API_URL}/website/projects/${projectId}`);
      applyContent(data);
    } catch (error) {
      console.error('Error deleting project:', error);
      toast.error('Failed to delete project');
    }
  };

  const handleProjectPhotos = async (projectId: string, files: FileList | File[] | null) => {
    const list = [...(files || [])].filter((file) => file && file.type.startsWith('image/'));
    if (!list.length) {
      toast.error('Images only');
      return;
    }
    try {
      setUploading(true);
      const formData = new FormData();
      list.forEach((file) => formData.append('file', file));
      const { data } = await axios.post(`${API_URL}/website/projects/${projectId}/photos`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      applyContent(data);
      toast.success(list.length === 1 ? 'Photo added' : `${list.length} photos added`);
    } catch (error) {
      console.error('Error uploading project photos:', error);
      toast.error('Failed to upload project photos');
    } finally {
      setUploading(false);
      setProjectPhotoTarget(null);
    }
  };

  const moveProjectPhoto = async (projectId: string, index: number, direction: -1 | 1) => {
    const project = content.projects.find((row) => row.id === projectId);
    if (!project) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= project.photos.length) return;
    const ids = project.photos.map((photo) => photo.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(nextIndex, 0, moved);
    try {
      const { data } = await axios.patch(`${API_URL}/website/order`, {
        section: 'projectPhotos',
        projectId,
        ids,
      });
      applyContent(data);
    } catch (error) {
      console.error('Error reordering project photos:', error);
      toast.error('Failed to reorder photos');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h1" sx={{ mb: 1 }}>
            Website
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Controls the customer homepage — hero photos, wording, featured projects, and gallery. Google tag setup is under Website Analytics.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={downloadingSlideshow ? <CircularProgress size={16} /> : <DownloadIcon />}
            onClick={() => void handleDownloadSlideshow()}
            disabled={!slideshowPhotoCount || downloadingSlideshow}
            sx={{ textTransform: 'none' }}
          >
            {downloadingSlideshow
              ? 'Preparing zip…'
              : `Download all photos (${slideshowPhotoCount})`}
          </Button>
          {tab === 0 ? (
            <Button variant="contained" onClick={() => void handleSaveCopy()} disabled={saving} sx={{ textTransform: 'none' }}>
              {saving ? 'Saving…' : 'Save copy'}
            </Button>
          ) : null}
        </Box>
      </Box>

      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={tab}
          onChange={(_, next) => setTab(next)}
          variant="scrollable"
          allowScrollButtonsMobile
        >
          <Tab label="Hero & copy" />
          <Tab label="Projects" />
          <Tab label="Gallery" />
          <Tab label="Preview" />
        </Tabs>
      </Paper>

      {tab === 0 ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
              Hero
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label="Headline"
                value={content.heroHeadline}
                onChange={(e) => handleField('heroHeadline', e.target.value)}
                fullWidth
              />
              <TextField
                label="Subheadline"
                value={content.heroSubheadline}
                onChange={(e) => handleField('heroSubheadline', e.target.value)}
                fullWidth
              />
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <TextField
                  label="Button label"
                  value={content.heroCtaLabel}
                  onChange={(e) => handleField('heroCtaLabel', e.target.value)}
                  sx={{ flex: 1, minWidth: 180 }}
                />
                <TextField
                  label="Button link"
                  value={content.heroCtaUrl}
                  onChange={(e) => handleField('heroCtaUrl', e.target.value)}
                  placeholder="mailto:office@sanclementewoodworking.com"
                  sx={{ flex: 2, minWidth: 240 }}
                />
              </Box>
            </Box>
            <Typography variant="subtitle2" sx={{ mt: 3, mb: 1, fontWeight: 600 }}>
              Hero photos
            </Typography>
            <input
              ref={heroInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              hidden
              onChange={(e) => {
                void uploadPhotos('/website/hero', e.target.files);
                e.target.value = '';
              }}
            />
            <Button
              variant="outlined"
              startIcon={<PhotoIcon />}
              onClick={() => heroInputRef.current?.click()}
              disabled={uploading}
              sx={{ textTransform: 'none', mb: 1.5 }}
            >
              {uploading ? 'Uploading…' : 'Add hero photos'}
            </Button>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
              {content.heroPhotos.map((photo, index) => (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  disableUp={index === 0}
                  disableDown={index === content.heroPhotos.length - 1}
                  onMoveUp={() => void moveItem('hero', index, -1)}
                  onMoveDown={() => void moveItem('hero', index, 1)}
                  onDelete={() => void deletePhoto(`/website/hero/${photo.id}`)}
                />
              ))}
              {content.heroPhotos.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No hero photos yet. These appear at the top of the homepage.
                </Typography>
              ) : null}
            </Box>
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
              About
            </Typography>
            <TextField
              label="Section title"
              value={content.aboutTitle}
              onChange={(e) => handleField('aboutTitle', e.target.value)}
              fullWidth
              sx={{ mb: 2 }}
            />
            <TextField
              label="About wording"
              value={content.aboutBody}
              onChange={(e) => handleField('aboutBody', e.target.value)}
              fullWidth
              multiline
              minRows={5}
            />
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
              Our story
            </Typography>
            <TextField
              label="Section title"
              value={content.storyTitle}
              onChange={(e) => handleField('storyTitle', e.target.value)}
              fullWidth
              sx={{ mb: 2 }}
            />
            <TextField
              label="Story wording"
              value={content.storyBody}
              onChange={(e) => handleField('storyBody', e.target.value)}
              fullWidth
              multiline
              minRows={6}
            />
          </Paper>

          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
              Quote banner
            </Typography>
            <TextField
              label="Banner text"
              value={content.quoteHeadline}
              onChange={(e) => handleField('quoteHeadline', e.target.value)}
              fullWidth
            />
          </Paper>
        </Box>
      ) : null}

      {tab === 1 ? (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary">
              Display number is list order (1, 2, 3…). The eye hides a job from the public site without deleting it.
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => void addProject()} sx={{ textTransform: 'none' }}>
              Add project
            </Button>
          </Box>
          {content.projects.length === 0 ? (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">No projects yet. Seed the catalog or add one here.</Typography>
            </Paper>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {content.projects.map((project, index) => (
                <Card
                  key={project.id}
                  variant="outlined"
                  sx={project.visible ? undefined : { opacity: 0.55 }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (saving || uploading) return;
                    void handleProjectPhotos(project.id, e.dataTransfer.files);
                  }}
                >
                  <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                      <Typography sx={{ fontWeight: 700, minWidth: 28, pt: 1 }}>{index + 1}.</Typography>
                      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                        <TextField
                          label="Project name"
                          size="small"
                          value={project.title}
                          onChange={(e) =>
                            setContent((prev) => ({
                              ...prev,
                              projects: prev.projects.map((row) =>
                                row.id === project.id ? { ...row, title: e.target.value } : row,
                              ),
                            }))
                          }
                        />
                        <ProjectSpecFields
                          projectId={project.id}
                          description={project.description}
                          onDescriptionChange={(description) => setProjectDescription(project.id, description)}
                        />
                      </Box>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, pl: { sm: 5 } }}>
                      {project.photos.map((photo, photoIndex) => (
                        <Box key={photo.id} sx={{ position: 'relative' }}>
                          <PhotoTile
                            photo={photo}
                            disableUp={photoIndex === 0}
                            disableDown={photoIndex === project.photos.length - 1}
                            onMoveUp={() => void moveProjectPhoto(project.id, photoIndex, -1)}
                            onMoveDown={() => void moveProjectPhoto(project.id, photoIndex, 1)}
                            onDelete={() => void deletePhoto(`/website/projects/${project.id}/photos/${photo.id}`)}
                          />
                          {photoIndex === 0 ? (
                            <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 0.5 }}>
                              Cover
                            </Typography>
                          ) : null}
                        </Box>
                      ))}
                      {project.photos.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
                          Drop photos here or use Add photos.
                        </Typography>
                      ) : null}
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', pl: { sm: 5 } }}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<PhotoIcon />}
                        disabled={uploading}
                        onClick={() => {
                          setProjectPhotoTarget(project.id);
                          projectPhotoInputRef.current?.click();
                        }}
                        sx={{ textTransform: 'none' }}
                      >
                        Add photos
                      </Button>
                      <Button size="small" onClick={() => void saveProject(project)} sx={{ textTransform: 'none' }}>
                        Save
                      </Button>
                      <IconButton
                        size="small"
                        onClick={() => void toggleProjectVisible(project)}
                        aria-label={project.visible ? 'Hide on public site' : 'Show on public site'}
                        title={project.visible ? 'Visible on the public site' : 'Hidden from the public site'}
                      >
                        {project.visible ? <VisibilityIcon fontSize="small" /> : <VisibilityOffIcon fontSize="small" />}
                      </IconButton>
                      <IconButton size="small" onClick={() => void moveItem('projects', index, -1)} disabled={index === 0} aria-label="Move project up">
                        <ArrowUpIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => void moveItem('projects', index, 1)}
                        disabled={index === content.projects.length - 1}
                        aria-label="Move project down"
                      >
                        <ArrowDownIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" color="error" onClick={() => void removeProject(project.id)} aria-label="Delete project">
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          )}
          <input
            ref={projectPhotoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            multiple
            hidden
            onChange={(e) => {
              const files = e.target.files;
              e.target.value = '';
              if (projectPhotoTarget) void handleProjectPhotos(projectPhotoTarget, files);
            }}
          />
        </Box>
      ) : null}

      {tab === 2 ? (
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, gap: 2, flexWrap: 'wrap' }}>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Gallery
            </Typography>
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              multiple
              hidden
              onChange={(e) => {
                void uploadPhotos('/website/gallery', e.target.files);
                e.target.value = '';
              }}
            />
            <Button
              variant="contained"
              startIcon={<PhotoIcon />}
              onClick={() => galleryInputRef.current?.click()}
              disabled={uploading}
              sx={{ textTransform: 'none' }}
            >
              {uploading ? 'Uploading…' : 'Add photos'}
            </Button>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
            {content.gallery.map((photo, index) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                disableUp={index === 0}
                disableDown={index === content.gallery.length - 1}
                onMoveUp={() => void moveItem('gallery', index, -1)}
                onMoveDown={() => void moveItem('gallery', index, 1)}
                onDelete={() => void deletePhoto(`/website/gallery/${photo.id}`)}
              />
            ))}
            {content.gallery.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No gallery photos yet.
              </Typography>
            ) : null}
          </Box>
        </Paper>
      ) : null}

      {tab === 3 ? (
        <Paper
          sx={{
            overflow: 'hidden',
            bgcolor: theme.palette.mode === 'dark' ? '#111' : '#f7f4ef',
          }}
        >
          <Box
            sx={{
              minHeight: 280,
              backgroundImage: content.heroPhotos[0] ? `url(${mediaSrc(content.heroPhotos[0].url)})` : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'flex',
              alignItems: 'flex-end',
              p: 4,
              color: '#fff',
              bgcolor: '#2c2c2c',
            }}
          >
            <Box>
              <Typography variant="h3" sx={{ fontWeight: 700, textShadow: '0 2px 12px rgba(0,0,0,0.45)' }}>
                {content.heroHeadline || 'Headline'}
              </Typography>
              {content.heroSubheadline ? (
                <Typography sx={{ mt: 1, textShadow: '0 1px 8px rgba(0,0,0,0.45)' }}>{content.heroSubheadline}</Typography>
              ) : null}
              {content.heroCtaLabel ? (
                <Button variant="contained" sx={{ mt: 2, textTransform: 'none' }}>
                  {content.heroCtaLabel}
                </Button>
              ) : null}
            </Box>
          </Box>
          <Box sx={{ p: 4, maxWidth: 780 }}>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
              {content.aboutTitle || 'About'}
            </Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap', mb: 4 }}>{content.aboutBody}</Typography>
            <Typography variant="h5" sx={{ fontWeight: 700, mb: 1 }}>
              {content.storyTitle || 'Our Story'}
            </Typography>
            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{content.storyBody}</Typography>
          </Box>
          {content.projects.some((project) => project.visible) ? (
            <Box sx={{ px: 4, pb: 4 }}>
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
                Projects
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 2 }}>
                {content.projects.filter((project) => project.visible).map((project) => (
                  <Box key={project.id}>
                    {project.photos[0] ? (
                      <Box
                        component="img"
                        src={mediaSrc(project.photos[0].url)}
                        alt={project.title}
                        sx={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: 1, mb: 1 }}
                      />
                    ) : null}
                    <Typography sx={{ fontWeight: 600 }}>{project.title}</Typography>
                    <SpecPreview description={project.description} />
                  </Box>
                ))}
              </Box>
            </Box>
          ) : null}
          {content.gallery.length ? (
            <Box sx={{ px: 4, pb: 4 }}>
              <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
                Gallery
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 }}>
                {content.gallery.map((photo) => (
                  <Box
                    key={photo.id}
                    component="img"
                    src={mediaSrc(photo.url)}
                    alt={photo.alt || ''}
                    sx={{ width: '100%', height: 100, objectFit: 'cover', borderRadius: 1 }}
                  />
                ))}
              </Box>
            </Box>
          ) : null}
          {content.quoteHeadline ? (
            <Box sx={{ px: 4, py: 5, textAlign: 'center', bgcolor: theme.palette.mode === 'dark' ? '#1a1a1a' : '#ece6dc' }}>
              <Typography variant="h4" sx={{ fontWeight: 700 }}>
                {content.quoteHeadline}
              </Typography>
            </Box>
          ) : null}
        </Paper>
      ) : null}
    </Container>
  );
}

export default WebsitePage;
