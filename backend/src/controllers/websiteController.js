const mongoose = require('mongoose');
const WebsiteContent = require('../models/WebsiteContent');
const WebsiteAnalyticsEvent = require('../models/WebsiteAnalyticsEvent');
const Tenant = require('../models/Tenant');
const { getFileStream, deleteStoredFileBinary } = require('./fileController');
const { getTenantContext } = require('../middleware/tenantContext');
const { writeStoreZip } = require('../utils/storeZip');
const { extractClientIp } = require('../services/clientNetwork');
const { publishWebsiteAnalyticsCreated } = require('../services/eventBus');

const GOOGLE_TAG_ID = /^(G|GT|AW|DC)-[A-Z0-9]+$/i;
const ADS_CUSTOMER_ID = /^\d{3}-\d{3}-\d{4}$/;
const EVENT_RATE = new Map();

const DEFAULTS = {
  heroHeadline: "Orange County's Skilled Staircase & Railing Experts",
  heroSubheadline: 'Custom staircases, railings, and millwork — family-owned since 1986.',
  heroCtaLabel: 'Contact Us for a Free Quote!',
  heroCtaUrl: 'mailto:office@sanclementewoodworking.com',
  aboutTitle: 'About Us',
  aboutBody:
    'Founded in 1986, San Clemente Woodworking is a family-owned and operated staircase business. We specialize in elegant custom staircases, including wood staircases, curved stairs, and stainless steel. By selectively using our own local milling and purchasing materials directly from manufacturers, we are able to maintain competitive pricing. Our skilled craftsmen are stair experts in bending rails, custom woodturning, and precise duplication of architectural designs. Your beautiful staircase by San Clemente Woodworking will be the envy of the neighborhood.',
  storyTitle: 'Our Story',
  storyBody:
    'We here at San Clemente Woodworking are committed to high quality workmanship in all of our stair building projects, specializing in custom staircases, iron and wood staircases, curved staircases and stainless steel. Today we are one of the largest custom staircase builders in the southern California area, providing our expert stair building services to numerous residents and building contractors throughout Orange County.\n\nAt San Clemente Woodworking, we pride ourselves on excellent and innovative custom staircase design. All of our staircases are created using traditional woodworking techniques, unsurpassed skill in installing and crafting your beautiful stairway. Stairways are available in a variety of woods, styles, components and stains.\n\nWhether renovating an existing staircase or creating a new staircase, San Clemente Woodworking will craft a stair design that is just right for you. You will be the envy of the neighborhood.',
  quoteHeadline: 'Contact Us for a Free Quote!',
};

function clip(value, max) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

function extractGoogleTagId(raw) {
  const text = String(raw || '');
  const match = text.match(/\b(?:G|GT|AW|DC)-[A-Z0-9]+\b/i);
  const id = match ? match[0] : text.replace(/\s+/g, '');
  return id.slice(0, 48);
}

function looksLikeAdsCustomerId(value) {
  const compact = String(value || '').replace(/\s+/g, '');
  if (!compact) return false;
  return ADS_CUSTOMER_ID.test(compact) || /^\d{8,12}$/.test(compact);
}

function pacificDayLabels(days) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const cursor = Date.UTC(year, month - 1, day);
  const labels = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    labels.push(new Date(cursor - i * 86400000).toISOString().slice(0, 10));
  }
  return labels;
}

function eventRateLimited(ip) {
  const now = Date.now();
  const recent = (EVENT_RATE.get(ip) || []).filter((stamp) => now - stamp < 60000);
  recent.push(now);
  EVENT_RATE.set(ip, recent);
  if (EVENT_RATE.size > 4000) {
    for (const [key, stamps] of EVENT_RATE) {
      if (!stamps.some((stamp) => now - stamp < 60000)) EVENT_RATE.delete(key);
    }
  }
  return recent.length > 180;
}

async function resolvePublicTenant(req) {
  const slug = String(req.query.slug || req.body?.slug || req.headers['x-tenant-slug'] || '')
    .trim()
    .toLowerCase();
  const tenantIdQuery = String(req.query.tenantId || req.body?.tenantId || '').trim();
  if (tenantIdQuery && /^[a-fA-F0-9]{24}$/.test(tenantIdQuery)) {
    return Tenant.findById(tenantIdQuery).setOptions({ bypassTenant: true });
  }
  if (slug) {
    return Tenant.findOne({ slug, isActive: { $ne: false } }).setOptions({ bypassTenant: true });
  }
  return Tenant.findOne({ isActive: { $ne: false } }).sort({ createdAt: 1 }).setOptions({ bypassTenant: true });
}

function tenantIdFromReq(req) {
  return req.user?.tenantId || getTenantContext()?.tenantId || null;
}

function mediaPath(tenantId, assetId) {
  return `/website/public/media/${tenantId}/${assetId}`;
}

function serializeAsset(asset, tenantId) {
  if (!asset) return null;
  const id = String(asset._id || '');
  if (!id) return null;
  return {
    id,
    alt: asset.alt || '',
    originalName: asset.originalName || '',
    url: mediaPath(tenantId, id),
  };
}

function projectPhotoList(project) {
  const photos = Array.isArray(project?.photos) ? project.photos.filter(Boolean) : [];
  if (photos.length) return photos;
  if (project?.photo) return [project.photo];
  return [];
}

function migrateProjectPhotos(doc) {
  if (!doc?.projects) return false;
  let changed = false;
  for (const project of doc.projects) {
    if (!Array.isArray(project.photos)) {
      project.photos = [];
      changed = true;
    }
    if (project.photo && project.photos.length === 0) {
      project.photos.push(project.photo);
      project.photo = undefined;
      changed = true;
    }
  }
  return changed;
}

function projectIsVisible(project) {
  return project?.visible !== false;
}

function serializeProject(project, tenantId) {
  return {
    id: String(project._id),
    slug: project.slug || '',
    title: project.title || '',
    description: project.description || '',
    visible: projectIsVisible(project),
    photos: projectPhotoList(project).map((photo) => serializeAsset(photo, tenantId)).filter(Boolean),
  };
}

function mineIpList(analytics) {
  return (Array.isArray(analytics?.mineIps) ? analytics.mineIps : [])
    .map((row) => ({
      ip: String(row?.ip || row || '').trim(),
      label: String(row?.label || 'Me').trim() || 'Me',
    }))
    .filter((row) => row.ip)
    .slice(0, 40);
}

function serializeAnalytics(doc) {
  const analytics = doc?.analytics || {};
  const conversions = Array.isArray(analytics.conversions) ? analytics.conversions : [];
  return {
    enabled: Boolean(analytics.enabled),
    measurementId: String(analytics.measurementId || '').trim(),
    adsId: String(analytics.adsId || '').trim(),
    campaignName: String(analytics.campaignName || 'Staircase Leads').trim() || 'Staircase Leads',
    conversions: conversions
      .map((row) => ({
        id: String(row._id || ''),
        name: String(row.name || '').trim(),
        trigger: ['contact_submit', 'contact_open', 'page_view'].includes(row.trigger)
          ? row.trigger
          : 'contact_submit',
        label: String(row.label || '').trim(),
      }))
      .filter((row) => row.name),
    mineIps: mineIpList(analytics),
  };
}

function serializeWebsite(doc, { publicOnly } = {}) {
  const tenantId = String(doc.tenantId);
  const projects = (doc.projects || []).filter((project) => !publicOnly || projectIsVisible(project));
  const analytics = serializeAnalytics(doc);
  return {
    id: String(doc._id),
    heroHeadline: doc.heroHeadline || '',
    heroSubheadline: doc.heroSubheadline || '',
    heroCtaLabel: doc.heroCtaLabel || '',
    heroCtaUrl: doc.heroCtaUrl || '',
    aboutTitle: doc.aboutTitle || '',
    aboutBody: doc.aboutBody || '',
    storyTitle: doc.storyTitle || '',
    storyBody: doc.storyBody || '',
    quoteHeadline: doc.quoteHeadline || '',
    heroPhotos: (doc.heroPhotos || []).map((photo) => serializeAsset(photo, tenantId)).filter(Boolean),
    gallery: (doc.gallery || []).map((photo) => serializeAsset(photo, tenantId)).filter(Boolean),
    projects: projects.map((project) => serializeProject(project, tenantId)),
    analytics: publicOnly
      ? analytics.enabled
        ? {
            enabled: true,
            measurementId: analytics.measurementId,
            adsId: analytics.adsId,
            conversions: analytics.conversions.map(({ name, trigger }) => ({ name, trigger })),
          }
        : { enabled: false, measurementId: '', adsId: '', conversions: [] }
      : analytics,
    updatedAt: doc.updatedAt,
  };
}

function assetFromUpload(file, alt = '') {
  const filename = file.filename || (file.key ? String(file.key).split('/').pop() : '');
  const s3Key = file.key || '';
  const storedPath = file.location || file.path || s3Key || filename;
  return {
    originalName: String(file.originalname || '').slice(0, 200),
    filename: String(filename || '').slice(0, 200),
    path: String(storedPath || '').slice(0, 500),
    s3Key: String(s3Key || '').slice(0, 500),
    mimetype: file.mimetype || file.contentType || 'image/jpeg',
    size: Number(file.size) || 0,
    alt: clip(alt, 160),
  };
}

function collectWebsiteAssets(content) {
  const seen = new Set();
  const assets = [];
  const add = (asset) => {
    const id = String(asset?._id || '');
    if (!id || seen.has(id)) return;
    seen.add(id);
    assets.push(asset);
  };
  for (const photo of content?.heroPhotos || []) add(photo);
  for (const photo of content?.gallery || []) add(photo);
  for (const project of content?.projects || []) {
    for (const photo of projectPhotoList(project)) add(photo);
  }
  return assets;
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function photoExtension(asset) {
  const named = String(asset?.originalName || asset?.filename || '');
  const match = named.match(/\.(jpe?g|png|gif|webp)$/i);
  if (match) return match[0].toLowerCase() === '.jpeg' ? '.jpg' : match[0].toLowerCase();
  const mime = String(asset?.mimetype || '').toLowerCase();
  if (mime.includes('png')) return '.png';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('webp')) return '.webp';
  return '.jpg';
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function downloadWebsiteSlideshowZip(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ error: 'Missing tenant' });
    const doc = await getOrCreateWebsite(tenantId);
    const assets = shuffleInPlace(collectWebsiteAssets(doc));
    if (!assets.length) {
      return res.status(404).json({ error: 'No website photos to download' });
    }

    req.setTimeout(10 * 60 * 1000);
    res.setTimeout(10 * 60 * 1000);

    const pad = String(assets.length).length < 3 ? 3 : String(assets.length).length;
    const files = [];
    for (let i = 0; i < assets.length; i += 1) {
      try {
        const stream = await getFileStream(assets[i]);
        const buffer = await streamToBuffer(stream);
        if (!buffer.length) continue;
        files.push({
          name: `${String(i + 1).padStart(pad, '0')}${photoExtension(assets[i])}`,
          buffer,
        });
      } catch (error) {
        console.error('Slideshow zip skipped photo:', assets[i]?._id, error?.message || error);
      }
    }
    if (!files.length) {
      return res.status(404).json({ error: 'Website photos could not be read' });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="website-slideshow.zip"');
    res.setHeader('Cache-Control', 'no-store');
    writeStoreZip(res, files);
  } catch (error) {
    console.error('Slideshow zip failed:', error?.message || error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Failed to download photos' });
    } else {
      res.end();
    }
  }
}

function findAsset(content, assetId) {
  const id = String(assetId || '');
  const hero = (content.heroPhotos || []).find((row) => String(row._id) === id);
  if (hero) return hero;
  const gallery = (content.gallery || []).find((row) => String(row._id) === id);
  if (gallery) return gallery;
  for (const project of content.projects || []) {
    const hit = projectPhotoList(project).find((row) => String(row._id) === id);
    if (hit) return hit;
  }
  return null;
}

async function getOrCreateWebsite(tenantId) {
  let doc = await WebsiteContent.findOne({ tenantId });
  if (doc) return doc;
  doc = new WebsiteContent({
    tenantId,
    ...DEFAULTS,
  });
  try {
    await doc.save();
    return doc;
  } catch (error) {
    if (error?.code === 11000) {
      return WebsiteContent.findOne({ tenantId });
    }
    throw error;
  }
}

async function getWebsite(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant is required' });
    const doc = await getOrCreateWebsite(tenantId);
    if (migrateProjectPhotos(doc)) await doc.save();
    res.json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load website content' });
  }
}

async function updateWebsite(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant is required' });
    const doc = await getOrCreateWebsite(tenantId);
    const body = req.body || {};
    doc.heroHeadline = clip(body.heroHeadline, 200);
    doc.heroSubheadline = clip(body.heroSubheadline, 400);
    doc.heroCtaLabel = clip(body.heroCtaLabel, 80);
    doc.heroCtaUrl = clip(body.heroCtaUrl, 400);
    doc.aboutTitle = clip(body.aboutTitle, 120);
    doc.aboutBody = clip(body.aboutBody, 8000);
    doc.storyTitle = clip(body.storyTitle, 120);
    doc.storyBody = clip(body.storyBody, 8000);
    doc.quoteHeadline = clip(body.quoteHeadline, 200);
    await doc.save();
    res.json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to save website content' });
  }
}

async function updateWebsiteAnalytics(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant is required' });
    const doc = await getOrCreateWebsite(tenantId);
    const body = req.body || {};
    const conversions = Array.isArray(body.conversions) ? body.conversions : [];
    if (looksLikeAdsCustomerId(body.measurementId) || looksLikeAdsCustomerId(body.adsId)) {
      return res.status(400).json({
        error: 'That looks like a Google Ads account number (123-456-7890). Use the AW- or G- tag from Tools → Data manager → Google tag.',
      });
    }
    const measurementId = extractGoogleTagId(body.measurementId);
    const adsId = extractGoogleTagId(body.adsId);
    if (body.enabled && !GOOGLE_TAG_ID.test(measurementId)) {
      return res.status(400).json({ error: 'Paste a Google tag ID starting with AW-, G-, or GT- before turning this on.' });
    }
    const previousMineIps = mineIpList(doc.analytics);
    doc.analytics = {
      enabled: Boolean(body.enabled),
      measurementId,
      adsId,
      campaignName: clip(body.campaignName, 120) || 'Staircase Leads',
      conversions: conversions
        .map((row) => ({
          name: clip(row?.name, 120),
          trigger: ['contact_submit', 'contact_open', 'page_view'].includes(row?.trigger)
            ? row.trigger
            : 'contact_submit',
          label: clip(row?.label, 160),
        }))
        .filter((row) => row.name)
        .slice(0, 20),
      mineIps: previousMineIps,
    };
    await doc.save();
    res.json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to save website analytics' });
  }
}

async function uploadHeroPhoto(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Image file is required' });
    const tenantId = tenantIdFromReq(req);
    const doc = await getOrCreateWebsite(tenantId);
    if ((doc.heroPhotos || []).length >= 12) {
      return res.status(400).json({ error: 'You can add up to 12 hero photos' });
    }
    doc.heroPhotos.push(assetFromUpload(req.file, req.body?.alt));
    await doc.save();
    res.status(201).json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to upload hero photo' });
  }
}

async function deleteHeroPhoto(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    const doc = await getOrCreateWebsite(tenantId);
    const asset = (doc.heroPhotos || []).find((row) => String(row._id) === String(req.params.assetId));
    if (!asset) return res.status(404).json({ error: 'Photo not found' });
    await deleteStoredFileBinary(asset);
    doc.heroPhotos = doc.heroPhotos.filter((row) => String(row._id) !== String(req.params.assetId));
    await doc.save();
    res.json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete hero photo' });
  }
}

async function uploadGalleryPhoto(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Image file is required' });
    const tenantId = tenantIdFromReq(req);
    const doc = await getOrCreateWebsite(tenantId);
    if ((doc.gallery || []).length >= 60) {
      return res.status(400).json({ error: 'You can add up to 60 gallery photos' });
    }
    doc.gallery.push(assetFromUpload(req.file, req.body?.alt));
    await doc.save();
    res.status(201).json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to upload gallery photo' });
  }
}

async function deleteGalleryPhoto(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    const doc = await getOrCreateWebsite(tenantId);
    const asset = (doc.gallery || []).find((row) => String(row._id) === String(req.params.assetId));
    if (!asset) return res.status(404).json({ error: 'Photo not found' });
    await deleteStoredFileBinary(asset);
    doc.gallery = doc.gallery.filter((row) => String(row._id) !== String(req.params.assetId));
    await doc.save();
    res.json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete gallery photo' });
  }
}

async function createProject(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    const doc = await getOrCreateWebsite(tenantId);
    if ((doc.projects || []).length >= 80) {
      return res.status(400).json({ error: 'You can add up to 80 projects' });
    }
    doc.projects.push({
      slug: clip(req.body?.slug, 160),
      title: clip(req.body?.title, 160) || 'New project',
      description: clip(req.body?.description, 2000),
      photos: [],
      visible: false,
    });
    await doc.save();
    res.status(201).json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to add project' });
  }
}

async function updateProject(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    const doc = await getOrCreateWebsite(tenantId);
    const project = (doc.projects || []).id(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (req.body?.title !== undefined) project.title = clip(req.body.title, 160);
    if (req.body?.description !== undefined) project.description = clip(req.body.description, 2000);
    if (req.body?.slug !== undefined) project.slug = clip(req.body.slug, 160);
    if (req.body?.visible !== undefined) project.visible = Boolean(req.body.visible);
    await doc.save();
    res.json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to update project' });
  }
}

async function deleteProject(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    const doc = await getOrCreateWebsite(tenantId);
    const project = (doc.projects || []).id(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const photos = projectPhotoList(project);
    for (const photo of photos) {
      await deleteStoredFileBinary(photo);
    }
    if (
      project.photo &&
      !photos.some((photo) => String(photo._id) === String(project.photo._id))
    ) {
      await deleteStoredFileBinary(project.photo);
    }
    project.deleteOne();
    await doc.save();
    res.json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete project' });
  }
}

async function uploadProjectPhoto(req, res) {
  try {
    const files = [...(req.files || []), req.file].filter(Boolean);
    if (!files.length) return res.status(400).json({ error: 'Image file is required' });
    const tenantId = tenantIdFromReq(req);
    const doc = await getOrCreateWebsite(tenantId);
    migrateProjectPhotos(doc);
    const project = (doc.projects || []).id(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (!Array.isArray(project.photos)) project.photos = [];
    const room = Math.max(0, 24 - project.photos.length);
    if (!room) return res.status(400).json({ error: 'You can add up to 24 photos per project' });
    for (const file of files.slice(0, room)) {
      project.photos.push(assetFromUpload(file, req.body?.alt || project.title));
    }
    await doc.save();
    res.status(201).json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to upload project photo' });
  }
}

async function deleteProjectPhoto(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    const doc = await getOrCreateWebsite(tenantId);
    migrateProjectPhotos(doc);
    const project = (doc.projects || []).id(req.params.projectId);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const asset = projectPhotoList(project).find((row) => String(row._id) === String(req.params.assetId));
    if (!asset) return res.status(404).json({ error: 'Photo not found' });
    await deleteStoredFileBinary(asset);
    project.photos = projectPhotoList(project).filter((row) => String(row._id) !== String(req.params.assetId));
    project.photo = undefined;
    await doc.save();
    res.json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to delete project photo' });
  }
}

function reorderByIds(items, ids) {
  const list = Array.isArray(items) ? [...items] : [];
  const wanted = (Array.isArray(ids) ? ids : []).map((id) => String(id));
  const byId = new Map(list.map((row) => [String(row._id), row]));
  const next = [];
  for (const id of wanted) {
    const row = byId.get(id);
    if (row) {
      next.push(row);
      byId.delete(id);
    }
  }
  for (const row of list) {
    if (byId.has(String(row._id))) next.push(row);
  }
  return next;
}

async function reorderWebsite(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    const doc = await getOrCreateWebsite(tenantId);
    const section = String(req.body?.section || '');
    const ids = req.body?.ids;
    if (section === 'hero') doc.heroPhotos = reorderByIds(doc.heroPhotos, ids);
    else if (section === 'gallery') doc.gallery = reorderByIds(doc.gallery, ids);
    else if (section === 'projects') doc.projects = reorderByIds(doc.projects, ids);
    else if (section === 'projectPhotos') {
      const project = (doc.projects || []).id(req.body?.projectId);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      migrateProjectPhotos(doc);
      project.photos = reorderByIds(projectPhotoList(project), ids);
      project.photo = undefined;
    } else return res.status(400).json({ error: 'section must be hero, gallery, projects, or projectPhotos' });
    await doc.save();
    res.json(serializeWebsite(doc));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to reorder' });
  }
}

async function getPublicWebsite(req, res) {
  try {
    const tenant = await resolvePublicTenant(req);
    if (!tenant) return res.status(404).json({ error: 'Website not found' });
    const doc = await WebsiteContent.findOne({ tenantId: tenant._id }).setOptions({ bypassTenant: true });
    if (doc) migrateProjectPhotos(doc);
    const payload = doc
      ? serializeWebsite(doc, { publicOnly: true })
      : serializeWebsite(
          {
            _id: 'default',
            tenantId: tenant._id,
            ...DEFAULTS,
            heroPhotos: [],
            gallery: [],
            projects: [],
          },
          { publicOnly: true },
        );
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({
      companyName: tenant.name || 'San Clemente Woodworking',
      ...payload,
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load public website' });
  }
}

async function getPublicWebsiteMedia(req, res) {
  try {
    const { tenantId, assetId } = req.params;
    if (!/^[a-fA-F0-9]{24}$/.test(String(tenantId || '')) || !/^[a-fA-F0-9]{24}$/.test(String(assetId || ''))) {
      return res.status(400).json({ error: 'Invalid media id' });
    }
    const doc = await WebsiteContent.findOne({ tenantId }).setOptions({ bypassTenant: true });
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const asset = findAsset(doc, assetId);
    if (!asset) return res.status(404).json({ error: 'Not found' });
    res.setHeader('Content-Type', asset.mimetype || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const stream = await getFileStream(asset);
    stream.on('error', (error) => {
      if (!res.headersSent) res.status(404).json({ error: 'Media missing' });
      else res.end();
      console.error('Website media stream error:', error?.message || error);
    });
    stream.pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(404).json({ error: error.message || 'Media not found' });
    }
  }
}

async function recordPublicAnalyticsEvent(req, res) {
  try {
    const ip = extractClientIp(req) || 'unknown';
    if (eventRateLimited(ip)) return res.status(204).end();
    const ua = String(req.headers['user-agent'] || '');
    if (/bot|crawl|spider|slurp|facebookexternalhit|preview|lighthouse|headless|httpclient/i.test(ua)) {
      return res.status(204).end();
    }
    const type = String(req.body?.type || '').trim();
    if (!WebsiteAnalyticsEvent.EVENT_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid event' });
    }
    const tenant = await resolvePublicTenant(req);
    if (!tenant) return res.status(404).json({ error: 'Website not found' });
    let path = String(req.body?.path || '/').trim() || '/';
    if (!path.startsWith('/')) path = `/${path}`;
    path = path.slice(0, 200).split('?')[0].split('#')[0] || '/';
    let referrer = '';
    try {
      const raw = String(req.body?.referrer || '').trim();
      if (raw) referrer = new URL(raw).host.slice(0, 200);
    } catch {
      referrer = clip(req.body?.referrer, 200);
    }
    const created = await WebsiteAnalyticsEvent.create([
      {
        tenantId: tenant._id,
        type,
        path,
        label: clip(req.body?.label, 160),
        href: clip(req.body?.href, 400),
        query: clip(req.body?.query, 300),
        sessionId: clip(req.body?.sessionId, 64).replace(/[^a-zA-Z0-9_-]/g, ''),
        referrer,
        ip: clip(ip, 64),
        userAgent: clip(ua, 220),
        occurredAt: new Date(),
      },
    ]);
    res.status(204).end();
    publishWebsiteAnalyticsCreated(req.app.get('io'), tenant._id, serializeTrafficEvent(created[0], new Set()));
    return;
  } catch (error) {
    if (!res.headersSent) res.status(204).end();
    console.error('Website analytics event error:', error?.message || error);
  }
}

function tenantObjectIdFromReq(req) {
  const tenantId = tenantIdFromReq(req);
  if (!tenantId || !mongoose.Types.ObjectId.isValid(String(tenantId))) return null;
  return new mongoose.Types.ObjectId(String(tenantId));
}

function serializeTrafficEvent(row, mineSet) {
  const ip = String(row.ip || '');
  return {
    id: String(row._id),
    type: row.type,
    path: row.path || '/',
    label: row.label || '',
    href: row.href || '',
    query: row.query || '',
    referrer: row.referrer || '',
    sessionId: row.sessionId || '',
    ip,
    userAgent: row.userAgent || '',
    mine: mineSet.has(ip),
    occurredAt: row.occurredAt,
  };
}

async function getWebsiteAnalyticsReport(req, res) {
  try {
    const tenantObjectId = tenantObjectIdFromReq(req);
    if (!tenantObjectId) return res.status(400).json({ error: 'Tenant is required' });
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const start = new Date(Date.now() - (days + 1) * 86400000);
    const site = await WebsiteContent.findOne({ tenantId: tenantObjectId }).setOptions({ bypassTenant: true });
    const mineIps = mineIpList(site?.analytics).map((row) => row.ip);
    const hideMine = String(req.query.hideMine || '') === '1' || String(req.query.hideMine || '') === 'true';
    const match = { tenantId: tenantObjectId, occurredAt: { $gte: start } };
    if (hideMine && mineIps.length) match.ip = { $nin: mineIps };
    const labels = pacificDayLabels(days);
    const todayLabel = labels[labels.length - 1];
    const adsQuery = { $regex: 'gclid=|gbraid=|wbraid=', $options: 'i' };
    const pacificDay = {
      $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: 'America/Los_Angeles' },
    };
    const [pageViews, clicks, contactOpens, contactSubmits, visitorIds, byDay, pages, adClicks, adSessionIds, campaignByDay] = await Promise.all([
      WebsiteAnalyticsEvent.countDocuments({ ...match, type: 'page_view' }),
      WebsiteAnalyticsEvent.countDocuments({ ...match, type: 'click' }),
      WebsiteAnalyticsEvent.countDocuments({ ...match, type: 'contact_open' }),
      WebsiteAnalyticsEvent.countDocuments({ ...match, type: 'contact_submit' }),
      WebsiteAnalyticsEvent.distinct('sessionId', match),
      WebsiteAnalyticsEvent.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: 'America/Los_Angeles' } },
              type: '$type',
            },
            count: { $sum: 1 },
            sessions: { $addToSet: '$sessionId' },
          },
        },
      ]),
      // Grouped by path *and* ip so each page can list who actually opened it.
      WebsiteAnalyticsEvent.aggregate([
        { $match: { ...match, type: 'page_view' } },
        {
          $group: {
            _id: { path: '$path', ip: '$ip' },
            views: { $sum: 1 },
            viewsToday: { $sum: { $cond: [{ $eq: [pacificDay, todayLabel] }, 1, 0] } },
            lastSeen: { $max: '$occurredAt' },
          },
        },
        {
          $group: {
            _id: '$_id.path',
            views: { $sum: '$views' },
            viewsToday: { $sum: '$viewsToday' },
            visitors: {
              $push: {
                ip: '$_id.ip',
                views: '$views',
                viewsToday: '$viewsToday',
                lastSeen: '$lastSeen',
              },
            },
          },
        },
        { $sort: { views: -1 } },
        { $limit: 8 },
      ]),
      WebsiteAnalyticsEvent.countDocuments({ ...match, type: 'page_view', query: adsQuery }),
      WebsiteAnalyticsEvent.distinct('sessionId', { ...match, query: adsQuery }),
      WebsiteAnalyticsEvent.aggregate([
        { $match: { ...match, $or: [{ query: adsQuery }, { type: 'contact_submit' }] } },
        {
          $group: {
            _id: {
              day: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: 'America/Los_Angeles' } },
              type: '$type',
              hasAds: { $cond: [{ $regexMatch: { input: { $ifNull: ['$query', ''] }, regex: /gclid=|gbraid=|wbraid=/i } }, true, false] },
            },
            count: { $sum: 1 },
            sessions: { $addToSet: '$sessionId' },
          },
        },
      ]),
    ]);
    const adSessions = adSessionIds.filter(Boolean);
    const adConversions = adSessions.length
      ? await WebsiteAnalyticsEvent.countDocuments({
          ...match,
          type: 'contact_submit',
          sessionId: { $in: adSessions },
        })
      : 0;
    const bucket = new Map(
      labels.map((date) => [date, { date, pageViews: 0, visitors: 0, clicks: 0, contactOpens: 0, contactSubmits: 0 }]),
    );
    for (const row of byDay) {
      const date = row?._id?.day;
      const current = bucket.get(date);
      if (!current) continue;
      const count = Number(row.count) || 0;
      if (row._id.type === 'page_view') {
        current.pageViews += count;
        current.visitors += Array.isArray(row.sessions) ? row.sessions.filter(Boolean).length : 0;
      } else if (row._id.type === 'click') current.clicks += count;
      else if (row._id.type === 'contact_open') current.contactOpens += count;
      else if (row._id.type === 'contact_submit') current.contactSubmits += count;
    }
    const campaignBucket = new Map(
      labels.map((date) => [date, { date, adClicks: 0, conversions: 0 }]),
    );
    const adSessionSet = new Set(adSessions);
    for (const row of campaignByDay) {
      const date = row?._id?.day;
      const current = campaignBucket.get(date);
      if (!current) continue;
      const count = Number(row.count) || 0;
      if (row._id.type === 'page_view' && row._id.hasAds) current.adClicks += count;
      if (row._id.type === 'contact_submit') {
        const attributed = Array.isArray(row.sessions)
          ? row.sessions.filter((id) => id && adSessionSet.has(id)).length
          : 0;
        current.conversions += attributed;
      }
    }
    res.json({
      days,
      mineIps: mineIpList(site?.analytics),
      totals: {
        pageViews,
        visitors: visitorIds.filter(Boolean).length,
        clicks,
        contactOpens,
        contactSubmits,
      },
      campaign: {
        adClicks,
        conversions: adConversions,
      },
      series: labels.map((date) => bucket.get(date)),
      campaignSeries: labels.map((date) => campaignBucket.get(date)),
      pages: pages.map((row) => ({
        path: row._id || '/',
        views: row.views || 0,
        viewsToday: row.viewsToday || 0,
        visitors: (Array.isArray(row.visitors) ? row.visitors : [])
          .map((visitor) => ({
            ip: visitor.ip || '',
            views: visitor.views || 0,
            viewsToday: visitor.viewsToday || 0,
            lastSeen: visitor.lastSeen || null,
            mine: mineIps.includes(visitor.ip || ''),
          }))
          .sort((a, b) => b.views - a.views)
          .slice(0, 25),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load website analytics' });
  }
}

async function getWebsiteAnalyticsTodayIps(req, res) {
  try {
    const tenantObjectId = tenantObjectIdFromReq(req);
    if (!tenantObjectId) return res.status(400).json({ error: 'Tenant is required' });
    const site = await WebsiteContent.findOne({ tenantId: tenantObjectId }).setOptions({ bypassTenant: true });
    const mineRows = mineIpList(site?.analytics);
    const mineSet = new Set(mineRows.map((row) => row.ip));
    const hideMine = String(req.query.hideMine || '') === '1' || String(req.query.hideMine || '') === 'true';
    const path = clip(req.query.path, 200);
    const todayLabel = pacificDayLabels(1)[0];
    const match = {
      tenantId: tenantObjectId,
      type: 'page_view',
      occurredAt: { $gte: new Date(Date.now() - 2 * 86400000) },
    };
    if (path) match.path = path;
    if (hideMine && mineSet.size) match.ip = { $nin: [...mineSet] };
    const rows = await WebsiteAnalyticsEvent.aggregate([
      { $match: match },
      {
        $addFields: {
          day: {
            $dateToString: { format: '%Y-%m-%d', date: '$occurredAt', timezone: 'America/Los_Angeles' },
          },
        },
      },
      { $match: { day: todayLabel } },
      {
        $group: {
          _id: '$ip',
          views: { $sum: 1 },
          lastAt: { $max: '$occurredAt' },
        },
      },
      { $sort: { views: -1, lastAt: -1 } },
      { $limit: 200 },
    ]);
    res.json({
      day: todayLabel,
      path: path || '',
      ips: rows.map((row) => ({
        ip: row._id || '',
        views: row.views || 0,
        lastAt: row.lastAt,
        mine: mineSet.has(String(row._id || '')),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load today\'s visitors' });
  }
}

async function getWebsiteAnalyticsEvents(req, res) {
  try {
    const tenantObjectId = tenantObjectIdFromReq(req);
    if (!tenantObjectId) return res.status(400).json({ error: 'Tenant is required' });
    const site = await WebsiteContent.findOne({ tenantId: tenantObjectId }).setOptions({ bypassTenant: true });
    const mineRows = mineIpList(site?.analytics);
    const mineSet = new Set(mineRows.map((row) => row.ip));
    const hideMine = String(req.query.hideMine || '') === '1' || String(req.query.hideMine || '') === 'true';
    const type = String(req.query.type || '').trim();
    const q = clip(req.query.q, 80);
    const limit = Math.min(80, Math.max(10, Number(req.query.limit) || 40));
    const match = { tenantId: tenantObjectId };
    if (hideMine && mineSet.size) match.ip = { $nin: [...mineSet] };
    if (WebsiteAnalyticsEvent.EVENT_TYPES.includes(type)) match.type = type;
    if (String(req.query.campaign || '') === '1') {
      match.query = { $regex: 'gclid=|gbraid=|wbraid=', $options: 'i' };
    }
    if (req.query.before) {
      const before = new Date(String(req.query.before));
      if (!Number.isNaN(before.getTime())) match.occurredAt = { $lt: before };
    }
    if (q) {
      match.$or = [
        { ip: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { label: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { path: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
        { locationLabel: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } },
      ];
    }
    const rows = await WebsiteAnalyticsEvent.find(match).sort({ occurredAt: -1 }).limit(limit + 1);
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map((row) => serializeTrafficEvent(row, mineSet));
    res.json({ events, hasMore, mineIps: mineRows });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to load traffic log' });
  }
}

async function updateWebsiteMineIp(req, res) {
  try {
    const tenantId = tenantIdFromReq(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant is required' });
    const ip = clip(req.body?.ip, 64);
    if (!ip) return res.status(400).json({ error: 'IP is required' });
    const doc = await getOrCreateWebsite(tenantId);
    const mine = mineIpList(doc.analytics);
    const mineFlag = req.body?.mine !== false && req.body?.mine !== 'false';
    const next = mineFlag
      ? [{ ip, label: clip(req.body?.label, 80) || 'Me' }, ...mine.filter((row) => row.ip !== ip)].slice(0, 40)
      : mine.filter((row) => row.ip !== ip);
    if (!doc.analytics) doc.analytics = {};
    doc.analytics.mineIps = next;
    doc.markModified('analytics');
    await doc.save();
    res.json({ mineIps: mineIpList(doc.analytics) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to save IP' });
  }
}

module.exports = {
  getWebsite,
  updateWebsite,
  updateWebsiteAnalytics,
  getWebsiteAnalyticsReport,
  getWebsiteAnalyticsTodayIps,
  getWebsiteAnalyticsEvents,
  updateWebsiteMineIp,
  recordPublicAnalyticsEvent,
  uploadHeroPhoto,
  deleteHeroPhoto,
  uploadGalleryPhoto,
  deleteGalleryPhoto,
  createProject,
  updateProject,
  deleteProject,
  uploadProjectPhoto,
  deleteProjectPhoto,
  reorderWebsite,
  getPublicWebsite,
  getPublicWebsiteMedia,
  downloadWebsiteSlideshowZip,
};
