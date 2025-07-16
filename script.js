// Global state
let state = {
  zoom: 1,
  panX: 0,
  panY: 0,
  notes: [],
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  lastPan: { x: 0, y: 0 },
  maxZIndex: 1
}

// Click handling state
let clickTimer = null
let clickPosition = { x: 0, y: 0 }
const CLICK_DELAY = 300 // ms to wait for potential double-click

// DOM elements
const viewport = document.getElementById('viewport')
const world = document.getElementById('world')

// Constants
const MIN_ZOOM = 0.1
const MAX_ZOOM = 5
const ZOOM_FACTOR = 0.175
const STORAGE_KEY = 'infinote-state'

// Initialize the app
async function init() {
  // Disable transition during initialization to prevent animation
  world.style.transition = 'none'

  try {
    await initDB()
    await loadState()
  } catch (e) {
    console.warn('Failed to initialize IndexedDB, falling back to localStorage:', e)
    // The loadState function already has localStorage fallback
    await loadState()
  }

  updateTransform()
  updateUI()

  attachEventListeners()

  // Handle instructions visibility
  handleInstructions()

  // Re-enable transition after all notes are loaded and positioned
  // Wait two frames to ensure DOM is fully settled
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      world.style.transition = 'transform 0.1s ease-out'
    })
  })
}

// Handle instructions visibility
function handleInstructions() {
  const instructions = document.querySelector('.instructions')
  if (!instructions) return

  const INSTRUCTIONS_SEEN_KEY = 'infinote-instructions-seen'
  const hasSeenInstructions = localStorage.getItem(INSTRUCTIONS_SEEN_KEY)

  if (!hasSeenInstructions) {
    // Show instructions if they haven't been seen before
    instructions.style.display = 'block'

    // Hide instructions after 5 seconds and mark as seen
    setTimeout(() => {
      instructions.style.opacity = '0'
      instructions.style.pointerEvents = 'none'
      instructions.style.transition = 'opacity 0.5s ease'

      // Mark instructions as seen
      localStorage.setItem(INSTRUCTIONS_SEEN_KEY, 'true')
    }, 5000)
  }
}

// Event listeners
function attachEventListeners() {
  // Mouse events for panning and note creation
  viewport.addEventListener('mousedown', handleMouseDown)
  viewport.addEventListener('mousemove', handleMouseMove)
  viewport.addEventListener('mouseup', handleMouseUp)
  viewport.addEventListener('mouseleave', handleMouseUp)

  // Double-click for reset view
  viewport.addEventListener('dblclick', handleDoubleClick)

  // Wheel event for zooming
  viewport.addEventListener('wheel', handleWheel, { passive: false })

  // Prevent context menu
  viewport.addEventListener('contextmenu', e => e.preventDefault())

  // Window resize
  window.addEventListener('resize', updateTransform)
}

// Mouse event handlers
function handleMouseDown(e) {
  if (e.target !== viewport && e.target !== world) return

  state.isDragging = true
  state.dragStart = { x: e.clientX, y: e.clientY }
  state.lastPan = { x: state.panX, y: state.panY }
  viewport.classList.add('dragging')
  e.preventDefault()
}

function handleMouseMove(e) {
  if (!state.isDragging) return

  const deltaX = e.clientX - state.dragStart.x
  const deltaY = e.clientY - state.dragStart.y

  state.panX = state.lastPan.x + deltaX
  state.panY = state.lastPan.y + deltaY

  updateTransform()
  e.preventDefault()
}

function handleMouseUp(e) {
  if (!state.isDragging) return

  const deltaX = Math.abs(e.clientX - state.dragStart.x)
  const deltaY = Math.abs(e.clientY - state.dragStart.y)

  // Check if any color picker is currently open
  const isColorPickerOpen = document.querySelector('.color-palette.show') !== null

  // Check if a textarea is currently focused
  const focusedTextarea = document.querySelector('textarea.note:focus')

  // If mouse didn't move much and no color picker is open, handle click with delay
  if (deltaX < 5 && deltaY < 5 && (e.target === viewport || e.target === world) && !isColorPickerOpen) {
    if (focusedTextarea) {
      // Just blur the focused textarea instead of creating a new note
      focusedTextarea.blur()
    } else {
      // Store click position and start timer for delayed note creation
      clickPosition.x = e.clientX
      clickPosition.y = e.clientY

      // Clear any existing timer
      if (clickTimer) {
        clearTimeout(clickTimer)
      }

      // Start timer for delayed note creation
      clickTimer = setTimeout(() => {
        createNoteAtPosition(clickPosition.x, clickPosition.y)
        clickTimer = null
      }, CLICK_DELAY)
    }
  }

  state.isDragging = false
  viewport.classList.remove('dragging')
  saveState()
}

// Double-click event handler
function handleDoubleClick(e) {
  // Only handle double-clicks on empty space
  if (e.target === viewport || e.target === world) {
    // Cancel any pending note creation
    if (clickTimer) {
      clearTimeout(clickTimer)
      clickTimer = null
    }

    // Execute reset view
    resetView()
    e.preventDefault()
  }
}

// Wheel event for zooming
function handleWheel(e) {
  // Don't zoom if wheeling inside a focused textarea
  if (e.target.tagName === 'TEXTAREA' && e.target.matches(':focus')) {
    return
  }

  e.preventDefault()

  const rect = viewport.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top

  // Calculate world coordinates before zoom
  const worldX = (mouseX - state.panX) / state.zoom
  const worldY = (mouseY - state.panY) / state.zoom

  // Update zoom
  const zoomDelta = e.deltaY > 0 ? -ZOOM_FACTOR * state.zoom / 2 : ZOOM_FACTOR * state.zoom / 2
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom + zoomDelta))

  // Calculate new pan to keep mouse position constant in world space
  state.panX = mouseX - worldX * newZoom
  state.panY = mouseY - worldY * newZoom
  state.zoom = newZoom

  updateTransform()
  updateUI()
  saveState()
}

// Create a new note at screen position
function createNoteAtPosition(screenX, screenY) {
  const rect = viewport.getBoundingClientRect()
  const mouseX = screenX - rect.left
  const mouseY = screenY - rect.top

  // Convert screen coordinates to world coordinates
  const worldX = (mouseX - state.panX) / state.zoom
  const worldY = (mouseY - state.panY) / state.zoom

  const note = {
    id: Date.now() + Math.random(),
    x: worldX,
    y: worldY,
    width: 150,
    height: 150,
    content: '',
    color: 'rgba(255, 245, 157, 0.95)',
    zIndex: ++state.maxZIndex
  }

  state.notes.push(note)
  renderNote(note)
  updateUI()
  saveState()

  // Focus the new note
  setTimeout(() => {
    const container = document.querySelector(`[data-note-id="${note.id}"]`)
    if (container) {
      const textarea = container.querySelector('.note')
      if (textarea) {
        textarea.focus()
      }
    }
  }, 100)
}

// Render a note element
function renderNote(note) {
  // Create container div
  const container = document.createElement('div')
  container.className = 'note-container'
  container.dataset.noteId = note.id

  // Position and size container
  container.style.left = `${note.x}px`
  container.style.top = `${note.y}px`
  container.style.width = `${note.width}px`
  container.style.height = `${note.height}px`
  container.style.zIndex = note.zIndex || 1

  // Create textarea
  const noteElement = document.createElement('textarea')
  noteElement.className = 'note'
  noteElement.value = note.content
  noteElement.spellcheck = false

  // Create color picker button
  const colorBtn = document.createElement('div')
  colorBtn.className = 'color-btn'
  colorBtn.style.backgroundColor = note.color || 'rgba(255, 255, 255, 0.95)'

  // Create color palette
  const colorPalette = document.createElement('div')
  colorPalette.className = 'color-palette'

  // Define 10 saturated colors
  const colors = [
    'rgba(255, 255, 255, 0.95)',  // White
    'rgba(255, 200, 200, 0.95)',  // Soft red
    'rgba(255, 220, 170, 0.95)',  // Soft orange
    'rgba(255, 245, 157, 0.95)',  // Soft yellow
    'rgba(200, 255, 200, 0.95)',  // Soft green
    'rgba(173, 216, 230, 0.95)',  // Soft blue
    'rgba(221, 160, 221, 0.95)',  // Soft purple
    'rgba(255, 182, 193, 0.95)',  // Soft pink
    'rgba(255, 218, 185, 0.95)',  // Soft peach
    'rgba(211, 211, 211, 0.95)'   // Light gray
  ]

  colors.forEach(color => {
    const colorOption = document.createElement('div')
    colorOption.className = 'palette-color'
    colorOption.style.backgroundColor = color
    if (color === note.color) {
      colorOption.classList.add('selected')
    }

    colorOption.addEventListener('mouseenter', e => {
      // Update note color on hover
      note.color = color
      colorBtn.style.backgroundColor = color
      noteElement.style.backgroundColor = color

      // Remove selected class from all colors
      colorPalette.querySelectorAll('.palette-color').forEach(c => c.classList.remove('selected'))
      // Add selected class to hovered color
      colorOption.classList.add('selected')
    })

    colorOption.addEventListener('click', e => {
      e.stopPropagation()
      // Commit the current color and hide palette
      originalColor = note.color
      colorPalette.classList.remove('show')
      saveState()
    })

    colorPalette.appendChild(colorOption)
  })

  let originalColor = note.color

  colorBtn.addEventListener('click', e => {
    e.stopPropagation()
    // Close other palettes first
    document.querySelectorAll('.color-palette.show').forEach(p => {
      if (p !== colorPalette) p.classList.remove('show')
    })

    // Store original color when opening
    if (!colorPalette.classList.contains('show')) {
      originalColor = note.color
    }

    colorPalette.classList.toggle('show')
  })

  // Reset to original color when mouse leaves palette
  colorPalette.addEventListener('mouseleave', e => {
    if (colorPalette.classList.contains('show')) {
      // Reset to original color
      note.color = originalColor
      colorBtn.style.backgroundColor = originalColor
      noteElement.style.backgroundColor = originalColor

      // Update selected state to match original color
      colorPalette.querySelectorAll('.palette-color').forEach(c => {
        c.classList.remove('selected')
        if (c.style.backgroundColor === originalColor) {
          c.classList.add('selected')
        }
      })
    }
  })

  // Hide palette when clicking elsewhere
  document.addEventListener('click', (e) => {
    if (!colorBtn.contains(e.target) && !colorPalette.contains(e.target)) {
      // Reset to original color when closing without selection
      note.color = originalColor
      colorBtn.style.backgroundColor = originalColor
      noteElement.style.backgroundColor = originalColor
      colorPalette.classList.remove('show')
    }
  })

  // Create delete button
  const deleteBtn = document.createElement('button')
  deleteBtn.className = 'delete-btn'
  deleteBtn.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#000" stroke-width="1.3" stroke-linecap="square" style="display: block; opacity: 0.2;">
      <path d="M4 4L8 8"/>
      <path d="M8 4L4 8"/>
    </svg>
  `
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation()
    deleteNote(note)
  })

  // Set note background color
  if (note.color) {
    noteElement.style.backgroundColor = note.color
  }

  // Append elements
  container.appendChild(noteElement)
  container.appendChild(colorBtn)
  container.appendChild(colorPalette)
  container.appendChild(deleteBtn)

  // Bring to front on any interaction
  function bringToFront() {
    state.maxZIndex++
    note.zIndex = state.maxZIndex
    container.style.zIndex = state.maxZIndex
    saveState()
  }

  // Event listeners for the note
  noteElement.addEventListener('input', () => {
    note.content = noteElement.value
    saveState()
  })

  noteElement.addEventListener('focus', () => {
    bringToFront()
    noteElement.style.cursor = 'text'
  })

  // Resize handling
  let isResizing = false
  let resizeData = null

  container.addEventListener('mousedown', e => {
    bringToFront()

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Don't handle clicks on color or delete buttons
    if (e.target === colorBtn || e.target === deleteBtn || colorPalette.contains(e.target)) {
      return
    }

    // Check if clicking in bottom-right resize handle area (20x20 px)
    if (x > rect.width - 20 && y > rect.height - 20) {
      isResizing = true
      resizeData = {
        startWidth: note.width,
        startHeight: note.height,
        startMouseX: e.clientX,
        startMouseY: e.clientY
      }
      noteElement.style.cursor = 'nw-resize'
      e.preventDefault()
      e.stopPropagation()
      return
    }

    e.stopPropagation()
  })

  // Handle drag (move note)
  let isDraggingNote = false
  let dragOffset = { x: 0, y: 0 }
  let dragStart = { x: 0, y: 0 }
  let hasMoved = false

  // Handle dragging from anywhere on the note
  noteElement.addEventListener('mousedown', e => {
    if (isResizing) return

    // Don't start dragging if clicking buttons
    if (e.target === colorBtn || e.target === deleteBtn || colorPalette.contains(e.target)) {
      return
    }

    // Don't start dragging if textarea is focused and click is inside it
    if (noteElement.matches(':focus')) {
      return
    }

    isDraggingNote = true
    hasMoved = false
    dragStart.x = e.clientX
    dragStart.y = e.clientY

    // Calculate offset from where user clicked within the note
    const rect = container.getBoundingClientRect()
    dragOffset.x = e.clientX - rect.left
    dragOffset.y = e.clientY - rect.top

    noteElement.style.userSelect = 'none'
    e.preventDefault()
  })

  // Global mouse handlers
  document.addEventListener('mousemove', e => {
    if (isResizing && resizeData) {
      // Calculate mouse delta from initial position
      const deltaX = e.clientX - resizeData.startMouseX
      const deltaY = e.clientY - resizeData.startMouseY

      // Apply delta to initial size, accounting for zoom
      const newWidth = Math.max(150, resizeData.startWidth + deltaX / state.zoom)
      const newHeight = Math.max(150, resizeData.startHeight + deltaY / state.zoom)

      // Update the container size (world coordinates)
      container.style.width = `${newWidth}px`
      container.style.height = `${newHeight}px`

      // Update the note data
      note.width = newWidth
      note.height = newHeight
      return
    }

    if (isDraggingNote) {
      const deltaX = Math.abs(e.clientX - dragStart.x)
      const deltaY = Math.abs(e.clientY - dragStart.y)

      // Start dragging if mouse moved more than 5px
      // if (deltaX > 5 || deltaY > 5) {
      hasMoved = true
      noteElement.style.cursor = 'grabbing'

      const rect = viewport.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      // Convert to world coordinates and maintain the click offset
      const worldX = (mouseX - dragOffset.x - state.panX) / state.zoom
      const worldY = (mouseY - dragOffset.y - state.panY) / state.zoom

      note.x = worldX
      note.y = worldY
      container.style.left = `${worldX}px`
      container.style.top = `${worldY}px`
      // }
      e.preventDefault()
    }
  })

  document.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false
      resizeData = null

      // Snap resize to 10x10 grid
      const gridSize = 10
      const snappedWidth = Math.round(note.width / gridSize) * gridSize
      const snappedHeight = Math.round(note.height / gridSize) * gridSize

      // Update note size to snapped coordinates
      note.width = Math.max(150, snappedWidth)
      note.height = Math.max(150, snappedHeight)
      container.style.width = `${note.width}px`
      container.style.height = `${note.height}px`

      noteElement.style.cursor = noteElement.matches(':focus') ? 'text' : 'grab'
      saveState()
    }

    if (isDraggingNote) {
      isDraggingNote = false
      noteElement.style.cursor = ''
      noteElement.style.userSelect = ''

      if (hasMoved) {
        // Snap to 10x10 grid
        const gridSize = 10
        const snappedX = Math.round(note.x / gridSize) * gridSize
        const snappedY = Math.round(note.y / gridSize) * gridSize

        // Update note position to snapped coordinates
        note.x = snappedX
        note.y = snappedY
        container.style.left = `${snappedX}px`
        container.style.top = `${snappedY}px`

        saveState()
      } else {
        // If didn't move, focus the textarea for editing
        setTimeout(() => {
          noteElement.focus()
        }, 10)
      }
    }
  })

  // Cursor management for resize handle
  container.addEventListener('mousemove', e => {
    if (isDraggingNote || isResizing) return

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (x > rect.width - 20 && y > rect.height - 20) {
      noteElement.style.cursor = 'nw-resize'
    } else if (noteElement.matches(':focus')) {
      noteElement.style.cursor = 'text'
    } else {
      noteElement.style.cursor = 'grab'
    }
  })

  container.addEventListener('mouseleave', () => {
    if (!isDraggingNote && !isResizing) {
      noteElement.style.cursor = noteElement.matches(':focus') ? 'text' : 'grab'
    }
  })

  world.appendChild(container)
}

// Delete a note
function deleteNote(note) {
  if (note.content === '' || confirm('Delete this note? This cannot be undone.')) {
    state.notes = state.notes.filter(n => n.id !== note.id)
    const container = document.querySelector(`[data-note-id="${note.id}"]`)
    if (container) {
      container.remove()
    }
    updateUI()
    saveState()
  }
}

// Update the world transform
function updateTransform() {
  world.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`
}

// Update UI indicators
function updateUI() {
  // zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`
  // noteCount.textContent = `${state.notes.length} notes`
}

// IndexedDB helper functions
let db = null

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('infinote', 1)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      db = request.result
      resolve(db)
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result
      if (!db.objectStoreNames.contains('state')) {
        db.createObjectStore('state', { keyPath: 'id' })
      }
    }
  })
}

function saveToIndexedDB(data) {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }

    const transaction = db.transaction(['state'], 'readwrite')
    const store = transaction.objectStore('state')
    const request = store.put({ id: 'main', data })

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  })
}

function loadFromIndexedDB() {
  return new Promise((resolve, reject) => {
    if (!db) {
      reject(new Error('Database not initialized'))
      return
    }

    const transaction = db.transaction(['state'], 'readonly')
    const store = transaction.objectStore('state')
    const request = store.get('main')

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.data)
      } else {
        resolve(null)
      }
    }
  })
}

// Save state to IndexedDB
async function saveState() {
  try {
    await saveToIndexedDB(state)
  } catch (e) {
    console.warn('Failed to save state to IndexedDB:', e)
    // Fallback to localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (fallbackError) {
      console.warn('Fallback to localStorage also failed:', fallbackError)
    }
  }
}

// Load state from IndexedDB
async function loadState() {
  try {
    const savedState = await loadFromIndexedDB()
    if (savedState) {
      state = { ...state, ...savedState }
      // Render all notes
      state.notes.forEach(note => renderNote(note))
    }
  } catch (e) {
    console.warn('Failed to load state from IndexedDB:', e)
    // Fallback to localStorage
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const loadedState = JSON.parse(saved)
        state = { ...state, ...loadedState }
        // Render all notes
        state.notes.forEach(note => renderNote(note))
      }
    } catch (fallbackError) {
      console.warn('Fallback to localStorage also failed:', fallbackError)
    }
  }
}

// Control functions
function resetView() {
  if (state.notes.length === 0) {
    // No notes, just reset to origin
    state.zoom = 1
    state.panX = 0
    state.panY = 0
  } else {
    // Calculate bounding box of all notes
    const minX = Math.min(...state.notes.map(n => n.x))
    const minY = Math.min(...state.notes.map(n => n.y))
    const maxX = Math.max(...state.notes.map(n => n.x + n.width))
    const maxY = Math.max(...state.notes.map(n => n.y + n.height))

    // Calculate center of all notes
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2

    // Calculate total dimensions
    const totalWidth = maxX - minX
    const totalHeight = maxY - minY

    // Get viewport dimensions
    const viewportRect = viewport.getBoundingClientRect()
    const viewportWidth = viewportRect.width
    const viewportHeight = viewportRect.height

    // Calculate zoom to fit all notes with 20% padding
    const padding = 0.2
    const zoomToFitWidth = (viewportWidth * (1 - padding)) / totalWidth
    const zoomToFitHeight = (viewportHeight * (1 - padding)) / totalHeight
    const fitZoom = Math.min(zoomToFitWidth, zoomToFitHeight)

    // Clamp zoom to min/max limits
    state.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, fitZoom))

    // Center the view on the center of all notes
    state.panX = viewportWidth / 2 - centerX * state.zoom
    state.panY = viewportHeight / 2 - centerY * state.zoom
  }

  updateTransform()
  updateUI()
  saveState()
}



// Initialize the app when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch(e => console.error('Failed to initialize app:', e))
  })
} else {
  init().catch(e => console.error('Failed to initialize app:', e))
}

// Make control functions global for onclick handlers
window.resetView = resetView
