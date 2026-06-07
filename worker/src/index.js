// ── Helpers ──

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function checkAuth(request, env) {
  return request.headers.get('X-Admin-Password') === env.ADMIN_PASSWORD;
}

async function getGallery(env) {
  const obj = await env.BUCKET.get('gallery.json');
  if (!obj) return [];
  return obj.json();
}

async function saveGallery(env, data) {
  await env.BUCKET.put('gallery.json', JSON.stringify(data), {
    httpMetadata: { contentType: 'application/json' },
  });
}

// ── Worker ──

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // Admin page
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(ADMIN_HTML, {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      // Public: list gallery items
      if (url.pathname === '/api/gallery' && request.method === 'GET') {
        return jsonRes(await getGallery(env));
      }

      // Auth: upload single photo
      if (url.pathname === '/api/upload' && request.method === 'POST') {
        if (!checkAuth(request, env)) return jsonRes({ error: 'Wrong password' }, 401);
        const form = await request.formData();
        const file = form.get('image');
        if (!file) return jsonRes({ error: 'No image provided' }, 400);

        const id = crypto.randomUUID();
        const ext = (file.name || 'photo.jpg').split('.').pop() || 'jpg';
        const key = 'images/' + id + '.' + ext;

        await env.BUCKET.put(key, file.stream(), {
          httpMetadata: { contentType: file.type || 'image/jpeg' },
        });

        const gallery = await getGallery(env);
        gallery.push({
          id,
          type: 'single',
          image: key,
          caption: form.get('caption') || '',
          tag: form.get('tag') || '',
          createdAt: Date.now(),
        });
        await saveGallery(env, gallery);
        return jsonRes({ success: true });
      }

      // Auth: upload before/after pair
      if (url.pathname === '/api/upload-pair' && request.method === 'POST') {
        if (!checkAuth(request, env)) return jsonRes({ error: 'Wrong password' }, 401);
        const form = await request.formData();
        const beforeFile = form.get('before_image');
        const afterFile = form.get('after_image');
        if (!beforeFile || !afterFile) return jsonRes({ error: 'Both images required' }, 400);

        const id = crypto.randomUUID();
        const bExt = (beforeFile.name || 'b.jpg').split('.').pop() || 'jpg';
        const aExt = (afterFile.name || 'a.jpg').split('.').pop() || 'jpg';
        const bKey = 'images/' + id + '-before.' + bExt;
        const aKey = 'images/' + id + '-after.' + aExt;

        await Promise.all([
          env.BUCKET.put(bKey, beforeFile.stream(), {
            httpMetadata: { contentType: beforeFile.type || 'image/jpeg' },
          }),
          env.BUCKET.put(aKey, afterFile.stream(), {
            httpMetadata: { contentType: afterFile.type || 'image/jpeg' },
          }),
        ]);

        const gallery = await getGallery(env);
        gallery.push({
          id,
          type: 'before-after',
          before: { image: bKey, caption: form.get('before_caption') || '' },
          after: { image: aKey, caption: form.get('after_caption') || '' },
          createdAt: Date.now(),
        });
        await saveGallery(env, gallery);
        return jsonRes({ success: true });
      }

      // Auth: delete item
      if (url.pathname.startsWith('/api/delete/') && request.method === 'DELETE') {
        if (!checkAuth(request, env)) return jsonRes({ error: 'Wrong password' }, 401);
        const id = url.pathname.replace('/api/delete/', '');
        const gallery = await getGallery(env);
        const item = gallery.find(function (i) { return i.id === id; });
        if (!item) return jsonRes({ error: 'Not found' }, 404);

        if (item.type === 'single') {
          await env.BUCKET.delete(item.image);
        } else {
          await Promise.all([
            env.BUCKET.delete(item.before.image),
            env.BUCKET.delete(item.after.image),
          ]);
        }

        await saveGallery(env, gallery.filter(function (i) { return i.id !== id; }));
        return jsonRes({ success: true });
      }

      // Public: serve image from R2
      if (url.pathname.startsWith('/image/')) {
        const key = 'images/' + url.pathname.slice(7);
        const obj = await env.BUCKET.get(key);
        if (!obj) return new Response('Not found', { status: 404 });
        return new Response(obj.body, {
          headers: {
            'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
            'Cache-Control': 'public, max-age=31536000',
            ...CORS_HEADERS,
          },
        });
      }

      return new Response('Not found', { status: 404 });
    } catch (err) {
      return jsonRes({ error: 'Server error: ' + err.message }, 500);
    }
  },
};

// ── Admin HTML ──

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Start Today - Photo Manager</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:16px;max-width:600px;margin:0 auto;line-height:1.5}
  h1{font-size:1.4rem;margin-bottom:4px} h1 span{color:#4ade80}
  .sub{color:#94a3b8;font-size:.9rem;margin-bottom:20px}
  .card{background:#1e293b;border-radius:12px;padding:20px;margin-bottom:16px}
  .card h2{font-size:1.1rem;margin-bottom:12px}
  label{display:block;font-size:.85rem;color:#94a3b8;margin-bottom:4px}
  input[type=text],input[type=password]{width:100%;padding:10px 12px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#fff;font-size:16px;margin-bottom:12px}
  input[type=file]{margin-bottom:12px;font-size:14px}
  button{padding:10px 20px;border-radius:8px;border:none;font-size:.95rem;font-weight:600;cursor:pointer}
  .btn{background:#4ade80;color:#000} .btn:hover{background:#22c55e}
  .btn-del{background:#ef4444;color:#fff;padding:6px 12px;font-size:.8rem}
  .tabs{display:flex;gap:8px;margin-bottom:16px}
  .tab{flex:1;text-align:center;padding:10px;border-radius:8px;cursor:pointer;background:#0f172a;font-weight:500;color:#94a3b8}
  .tab.active{background:#4ade80;color:#000}
  .upl{display:none} .upl.active{display:block}
  .preview{max-width:100%;max-height:200px;border-radius:8px;margin-bottom:12px;display:none}
  .status{padding:10px;border-radius:8px;margin-bottom:12px;text-align:center;display:none;font-size:.9rem}
  .status.ok{background:#065f46;display:block} .status.err{background:#7f1d1d;display:block} .status.info{background:#1e40af;display:block}
  .entry{display:flex;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid #334155}
  .entry:last-child{border-bottom:none}
  .entry img{width:80px;height:60px;object-fit:cover;border-radius:6px;flex-shrink:0}
  .entry .inf{flex:1;min-width:0} .entry .inf strong{display:block;font-size:.85rem} .entry .inf span{font-size:.8rem;color:#94a3b8}
  .pair{display:flex;gap:4px}
  .empty{color:#64748b;text-align:center;padding:24px}
  .pwr{display:flex;gap:8px} .pwr input{flex:1;margin-bottom:0}
</style>
</head>
<body>
<h1><span>Start Today</span> Photo Manager</h1>
<p class="sub">Upload and manage your gallery photos</p>

<div class="card">
  <h2>Password</h2>
  <div class="pwr">
    <input type="password" id="pw" placeholder="Enter admin password">
    <button class="btn" onclick="savePw()">Save</button>
  </div>
</div>

<div id="status" class="status"></div>

<div class="card">
  <h2>Upload Photo</h2>
  <div class="tabs">
    <div class="tab active" data-mode="single" onclick="setMode(this)">Single Photo</div>
    <div class="tab" data-mode="pair" onclick="setMode(this)">Before & After</div>
  </div>
  <div id="f-single" class="upl active">
    <label>Photo</label>
    <input type="file" id="s-file" accept="image/*" onchange="prev(this,'s-prev')">
    <img id="s-prev" class="preview">
    <label>Caption</label>
    <input type="text" id="s-cap" placeholder="e.g. Full yard cleanout">
    <label>Tag (optional)</label>
    <input type="text" id="s-tag" placeholder="e.g. Yard Waste, Furniture, Demo">
    <button class="btn" onclick="uplSingle()" style="width:100%">Upload</button>
  </div>
  <div id="f-pair" class="upl">
    <label>Before Photo</label>
    <input type="file" id="b-file" accept="image/*" onchange="prev(this,'b-prev')">
    <img id="b-prev" class="preview">
    <label>Before Caption</label>
    <input type="text" id="b-cap" placeholder="e.g. Cluttered garage">
    <label>After Photo</label>
    <input type="file" id="a-file" accept="image/*" onchange="prev(this,'a-prev')">
    <img id="a-prev" class="preview">
    <label>After Caption</label>
    <input type="text" id="a-cap" placeholder="e.g. Clean and organized">
    <button class="btn" onclick="uplPair()" style="width:100%">Upload Pair</button>
  </div>
</div>

<div class="card">
  <h2>Current Gallery</h2>
  <div id="list"><p class="empty">Loading...</p></div>
</div>

<script>
var pw = localStorage.getItem('st_pw') || '';
document.getElementById('pw').value = pw;

function savePw() {
  pw = document.getElementById('pw').value;
  localStorage.setItem('st_pw', pw);
  msg('Password saved', 'ok');
}

function msg(t, c) {
  var el = document.getElementById('status');
  el.textContent = t; el.className = 'status ' + c;
  if (c === 'ok') setTimeout(function() { el.style.display = 'none'; }, 3000);
}

function setMode(el) {
  var m = el.dataset.mode;
  var tabs = document.querySelectorAll('.tab');
  for (var i = 0; i < tabs.length; i++) tabs[i].className = 'tab' + (tabs[i].dataset.mode === m ? ' active' : '');
  document.getElementById('f-single').className = 'upl' + (m === 'single' ? ' active' : '');
  document.getElementById('f-pair').className = 'upl' + (m === 'pair' ? ' active' : '');
}

function prev(input, imgId) {
  var img = document.getElementById(imgId);
  if (input.files[0]) {
    var r = new FileReader();
    r.onload = function(e) { img.src = e.target.result; img.style.display = 'block'; };
    r.readAsDataURL(input.files[0]);
  } else { img.style.display = 'none'; }
}

function compress(file) {
  return new Promise(function(resolve) {
    var r = new FileReader();
    r.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        var c = document.createElement('canvas');
        var w = img.width, h = img.height, M = 1920;
        if (w > M || h > M) {
          if (w > h) { h = Math.round(h * M / w); w = M; }
          else { w = Math.round(w * M / h); h = M; }
        }
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        c.toBlob(function(b) { resolve(b); }, 'image/jpeg', 0.85);
      };
      img.src = e.target.result;
    };
    r.readAsDataURL(file);
  });
}

async function api(method, path, body) {
  var opts = { method: method, headers: { 'X-Admin-Password': pw } };
  if (body) opts.body = body;
  var res = await fetch(path, opts);
  return res.json();
}

async function uplSingle() {
  var f = document.getElementById('s-file').files[0];
  if (!f) return msg('Select a photo first', 'err');
  msg('Compressing & uploading...', 'info');
  var blob = await compress(f);
  var fd = new FormData();
  fd.append('image', blob, 'photo.jpg');
  fd.append('caption', document.getElementById('s-cap').value);
  fd.append('tag', document.getElementById('s-tag').value);
  var r = await api('POST', '/api/upload', fd);
  if (r.success) {
    msg('Photo uploaded!', 'ok');
    document.getElementById('s-file').value = '';
    document.getElementById('s-cap').value = '';
    document.getElementById('s-tag').value = '';
    document.getElementById('s-prev').style.display = 'none';
    loadGallery();
  } else { msg(r.error || 'Upload failed', 'err'); }
}

async function uplPair() {
  var bf = document.getElementById('b-file').files[0];
  var af = document.getElementById('a-file').files[0];
  if (!bf || !af) return msg('Select both photos', 'err');
  msg('Compressing & uploading...', 'info');
  var results = await Promise.all([compress(bf), compress(af)]);
  var fd = new FormData();
  fd.append('before_image', results[0], 'before.jpg');
  fd.append('after_image', results[1], 'after.jpg');
  fd.append('before_caption', document.getElementById('b-cap').value);
  fd.append('after_caption', document.getElementById('a-cap').value);
  var r = await api('POST', '/api/upload-pair', fd);
  if (r.success) {
    msg('Before & After uploaded!', 'ok');
    document.getElementById('b-file').value = '';
    document.getElementById('a-file').value = '';
    document.getElementById('b-cap').value = '';
    document.getElementById('a-cap').value = '';
    document.getElementById('b-prev').style.display = 'none';
    document.getElementById('a-prev').style.display = 'none';
    loadGallery();
  } else { msg(r.error || 'Upload failed', 'err'); }
}

async function delItem(btn) {
  if (!confirm('Delete this photo?')) return;
  var r = await api('DELETE', '/api/delete/' + btn.dataset.id);
  if (r.success) { msg('Deleted', 'ok'); loadGallery(); }
  else { msg(r.error || 'Delete failed', 'err'); }
}

function esc(s) {
  var d = document.createElement('div');
  d.textContent = s || '';
  return d.innerHTML;
}

async function loadGallery() {
  var el = document.getElementById('list');
  try {
    var res = await fetch('/api/gallery');
    var items = await res.json();
    if (!items.length) { el.innerHTML = '<p class="empty">No photos yet. Upload your first one above!</p>'; return; }
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.type === 'single') {
        html += '<div class="entry">' +
          '<img src="/image/' + it.image.replace('images/', '') + '">' +
          '<div class="inf"><strong>' + esc(it.tag) + '</strong><span>' + esc(it.caption) + '</span></div>' +
          '<button class="btn-del" data-id="' + it.id + '" onclick="delItem(this)">Delete</button></div>';
      } else {
        html += '<div class="entry">' +
          '<div class="pair">' +
          '<img src="/image/' + it.before.image.replace('images/', '') + '">' +
          '<img src="/image/' + it.after.image.replace('images/', '') + '">' +
          '</div>' +
          '<div class="inf"><strong>Before & After</strong><span>' + esc(it.before.caption) + ' / ' + esc(it.after.caption) + '</span></div>' +
          '<button class="btn-del" data-id="' + it.id + '" onclick="delItem(this)">Delete</button></div>';
      }
    }
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<p class="empty">Could not load gallery</p>';
  }
}

loadGallery();
</script>
</body>
</html>`;
