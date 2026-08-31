const previews = new WeakMap()

const VERTEX = `
attribute vec3 a_position;
attribute vec2 a_uv;
uniform mat4 u_matrix;
varying vec2 v_uv;
void main() {
  gl_Position = u_matrix * vec4(a_position, 1.0);
  v_uv = a_uv;
}`

const FRAGMENT = `
precision mediump float;
uniform sampler2D u_texture;
uniform float u_alphaCutoff;
varying vec2 v_uv;
void main() {
  vec4 color = texture2D(u_texture, v_uv);
  if (color.a <= u_alphaCutoff) discard;
  gl_FragColor = color;
}`

function shader(gl, type, source) {
  const value = gl.createShader(type)
  gl.shaderSource(value, source)
  gl.compileShader(value)
  if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value) || 'Skin preview shader compile failed')
  return value
}

function program(gl) {
  const value = gl.createProgram()
  gl.attachShader(value, shader(gl, gl.VERTEX_SHADER, VERTEX))
  gl.attachShader(value, shader(gl, gl.FRAGMENT_SHADER, FRAGMENT))
  gl.linkProgram(value)
  if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value) || 'Skin preview shader link failed')
  return value
}

function multiply(a, b) {
  const out = new Float32Array(16)
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
  }
  return out
}

function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2), nf = 1 / (near - far)
  return new Float32Array([f / aspect,0,0,0, 0,f,0,0, 0,0,(far + near) * nf,-1, 0,0,2 * far * near * nf,0])
}

function translation(x, y, z) {
  return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1])
}

function rotateX(v) {
  const c = Math.cos(v), s = Math.sin(v)
  return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1])
}

function rotateY(v) {
  const c = Math.cos(v), s = Math.sin(v)
  return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1])
}

function uvRect(x, y, w, h) {
  const u0 = x / 64, v0 = y / 64, u1 = (x + w) / 64, v1 = (y + h) / 64
  return [[u0,v0],[u1,v0],[u1,v1],[u0,v1]]
}

function addFace(vertices, uvs, corners, rect, flip = false) {
  const t = uvRect(...rect)
  const order = flip ? [1,0,3, 1,3,2] : [0,1,2, 0,2,3]
  for (const i of order) {
    vertices.push(...corners[i])
    uvs.push(...t[i])
  }
}

function addBox(mesh, center, size, faces, inflate = 0) {
  const [cx, cy, cz] = center
  const [sx0, sy0, sz0] = size
  const sx = sx0 + inflate * 2, sy = sy0 + inflate * 2, sz = sz0 + inflate * 2
  const x0 = cx - sx / 2, x1 = cx + sx / 2
  const y0 = cy - sy / 2, y1 = cy + sy / 2
  const z0 = cz - sz / 2, z1 = cz + sz / 2
  const { vertices, uvs } = mesh
  addFace(vertices, uvs, [[x0,y1,z1],[x1,y1,z1],[x1,y0,z1],[x0,y0,z1]], faces.front)
  addFace(vertices, uvs, [[x1,y1,z0],[x0,y1,z0],[x0,y0,z0],[x1,y0,z0]], faces.back)
  addFace(vertices, uvs, [[x0,y1,z0],[x0,y1,z1],[x0,y0,z1],[x0,y0,z0]], faces.right)
  addFace(vertices, uvs, [[x1,y1,z1],[x1,y1,z0],[x1,y0,z0],[x1,y0,z1]], faces.left)
  addFace(vertices, uvs, [[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]], faces.top)
  addFace(vertices, uvs, [[x0,y0,z1],[x1,y0,z1],[x1,y0,z0],[x0,y0,z0]], faces.bottom)
}

function faceMap(x, y, w, h, d) {
  return {
    top: [x + d, y, w, d],
    bottom: [x + d + w, y, w, d],
    right: [x, y + d, d, h],
    front: [x + d, y + d, w, h],
    left: [x + d + w, y + d, d, h],
    back: [x + d + w + d, y + d, w, h],
  }
}

function buildMesh(model, overlay) {
  const mesh = { vertices: [], uvs: [] }
  const slim = model === 'slim'
  const armW = slim ? 3 : 4
  const puff = overlay ? 0.24 : 0

  if (!overlay) {
    addBox(mesh, [0, 28, 0], [8,8,8], faceMap(0,0,8,8,8))
    addBox(mesh, [0, 18, 0], [8,12,4], faceMap(16,16,8,12,4))
    addBox(mesh, [-(4 + armW / 2),18,0], [armW,12,4], faceMap(40,16,armW,12,4))
    addBox(mesh, [4 + armW / 2,18,0], [armW,12,4], faceMap(32,48,armW,12,4))
    addBox(mesh, [-2,6,0], [4,12,4], faceMap(0,16,4,12,4))
    addBox(mesh, [2,6,0], [4,12,4], faceMap(16,48,4,12,4))
  } else {
    addBox(mesh, [0,28,0], [8,8,8], faceMap(32,0,8,8,8), puff)
    addBox(mesh, [0,18,0], [8,12,4], faceMap(16,32,8,12,4), puff)
    addBox(mesh, [-(4 + armW / 2),18,0], [armW,12,4], faceMap(40,32,armW,12,4), puff)
    addBox(mesh, [4 + armW / 2,18,0], [armW,12,4], faceMap(48,48,armW,12,4), puff)
    addBox(mesh, [-2,6,0], [4,12,4], faceMap(0,32,4,12,4), puff)
    addBox(mesh, [2,6,0], [4,12,4], faceMap(0,48,4,12,4), puff)
  }
  return mesh
}

class SkinPreview3D {
  constructor(canvas) {
    this.canvas = canvas
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false })
    if (!this.gl) throw new Error('WebGL is unavailable')
    this.program = program(this.gl)
    this.position = this.gl.getAttribLocation(this.program, 'a_position')
    this.uv = this.gl.getAttribLocation(this.program, 'a_uv')
    this.matrix = this.gl.getUniformLocation(this.program, 'u_matrix')
    this.cutoff = this.gl.getUniformLocation(this.program, 'u_alphaCutoff')
    this.texture = this.gl.createTexture()
    this.baseBuffer = this.gl.createBuffer()
    this.baseUvBuffer = this.gl.createBuffer()
    this.overlayBuffer = this.gl.createBuffer()
    this.overlayUvBuffer = this.gl.createBuffer()
    this.baseCount = 0
    this.overlayCount = 0
    this.model = 'classic'
    this.yaw = -0.5
    this.pitch = -0.08
    this.dragging = false
    this.dragCounted = false
    this.lastX = 0
    this.lastY = 0
    this.lastInteraction = 0
    this.ready = false
    this.imageKey = ''
    this.installInput()
    this.loop = this.loop.bind(this)
    requestAnimationFrame(this.loop)
  }

  installInput() {
    const c = this.canvas
    c.addEventListener('pointerdown', event => {
      this.dragging = true
      this.dragCounted = false
      this.lastX = event.clientX
      this.lastY = event.clientY
      this.lastInteraction = performance.now()
      c.__hemPreviewDragged = false
      c.setPointerCapture?.(event.pointerId)
    })
    c.addEventListener('pointermove', event => {
      if (!this.dragging) return
      const dx = event.clientX - this.lastX, dy = event.clientY - this.lastY
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        c.__hemPreviewDragged = true
        if (!this.dragCounted) {
          c.__hemPreviewDragCount = Number(c.__hemPreviewDragCount || 0) + 1
          this.dragCounted = true
        }
      }
      this.yaw += dx * 0.012
      this.pitch = Math.max(-0.55, Math.min(0.35, this.pitch + dy * 0.008))
      this.lastX = event.clientX
      this.lastY = event.clientY
      this.lastInteraction = performance.now()
    })
    const end = event => {
      this.dragging = false
      this.lastInteraction = performance.now()
      c.releasePointerCapture?.(event.pointerId)
    }
    c.addEventListener('pointerup', end)
    c.addEventListener('pointercancel', end)
  }

  setSkin(dataUrl, model) {
    if (this.model !== model) {
      this.model = model
      this.uploadMesh()
    }
    const key = `${model}:${dataUrl || ''}`
    if (key === this.imageKey) return
    this.imageKey = key
    const image = new Image()
    image.onload = () => {
      const gl = this.gl
      gl.bindTexture(gl.TEXTURE_2D, this.texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.ready = true
    }
    image.src = dataUrl
  }

  uploadMesh() {
    const gl = this.gl
    const base = buildMesh(this.model, false), overlay = buildMesh(this.model, true)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.baseBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(base.vertices), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.baseUvBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(base.uvs), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.overlayBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(overlay.vertices), gl.STATIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.overlayUvBuffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(overlay.uvs), gl.STATIC_DRAW)
    this.baseCount = base.vertices.length / 3
    this.overlayCount = overlay.vertices.length / 3
  }

  drawMesh(positionBuffer, uvBuffer, count, cutoff) {
    const gl = this.gl
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
    gl.enableVertexAttribArray(this.position)
    gl.vertexAttribPointer(this.position, 3, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer)
    gl.enableVertexAttribArray(this.uv)
    gl.vertexAttribPointer(this.uv, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1f(this.cutoff, cutoff)
    gl.drawArrays(gl.TRIANGLES, 0, count)
  }

  render(now) {
    if (!this.ready) return
    const gl = this.gl, c = this.canvas
    const width = Math.max(1, Math.round(c.clientWidth * Math.min(devicePixelRatio || 1, 2)))
    const height = Math.max(1, Math.round(c.clientHeight * Math.min(devicePixelRatio || 1, 2)))
    if (c.width !== width || c.height !== height) { c.width = width; c.height = height }
    if (!this.dragging && now - this.lastInteraction > 2500 && !document.body.classList.contains('reduce-motion')) this.yaw += 0.0025
    gl.viewport(0, 0, width, height)
    gl.clearColor(0,0,0,0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.enable(gl.CULL_FACE)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.useProgram(this.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.texture)
    let matrix = perspective(Math.PI / 4.4, width / height, 0.1, 200)
    matrix = multiply(matrix, translation(0, -16, -57))
    matrix = multiply(matrix, rotateX(this.pitch))
    matrix = multiply(matrix, rotateY(this.yaw))
    gl.uniformMatrix4fv(this.matrix, false, matrix)
    this.drawMesh(this.baseBuffer, this.baseUvBuffer, this.baseCount, 0)
    this.drawMesh(this.overlayBuffer, this.overlayUvBuffer, this.overlayCount, 0.02)
  }

  loop(now) {
    this.render(now)
    requestAnimationFrame(this.loop)
  }
}

export function renderSkinPreview3D(canvas, dataUrl, model = 'classic') {
  if (!canvas || !dataUrl) return false
  try {
    let preview = previews.get(canvas)
    if (!preview) {
      preview = new SkinPreview3D(canvas)
      previews.set(canvas, preview)
      canvas.dataset.preview = 'webgl-3d'
      canvas.setAttribute('aria-description', 'Interactive 3D skin preview. Drag to rotate; click without dragging to choose a PNG skin.')
    }
    preview.setSkin(dataUrl, model)
    return true
  } catch (error) {
    console.warn('HEM WebGL skin preview unavailable; using 2D fallback.', error)
    canvas.dataset.preview = '2d-fallback'
    return false
  }
}
