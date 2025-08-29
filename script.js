// Global state
let state = {
  zoom: 1,
  panX: 0,
  panY: 0,
  notes: [],
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  lastPan: { x: 0, y: 0 },
  maxZIndex: 1,
}

// Note interaction state
let currentNote = null
let isResizingNote = false
let isDraggingNote = false
let noteDragData = null
let noteResizeData = null

// Click handling state
let clickTimer = null
let clickPosition = { x: 0, y: 0 }
const CLICK_DELAY = 300 // ms to wait for potential double-click

// Touch handling state
let touches = []
let lastPinchDistance = 0
let isPinching = false
let isTouchPanning = false
let touchPanStart = { x: 0, y: 0 }
let touchLastPan = { x: 0, y: 0 }
let lastPinchCenter = { x: 0, y: 0 }

// Double-tap detection for mobile
let lastTapTime = 0
let lastTapX = 0
let lastTapY = 0
const DOUBLE_TAP_DELAY = 300 // ms
const DOUBLE_TAP_DISTANCE = 40 // px

// Tap-to-create-note detection for mobile
let tapStartTime = 0
let tapStartX = 0
let tapStartY = 0
const TAP_MAX_DURATION = 250 // ms
const TAP_MAX_MOVE = 10 // px
let tapMoved = false
let tapCreateNoteTimer = null
let tapCreateNotePosition = { x: 0, y: 0 }

// DOM elements
const viewport = document.getElementById('viewport')
const world = document.getElementById('world')

// Constants
const MIN_ZOOM = 0.1
const MAX_ZOOM = 5
const ZOOM_FACTOR = 0.05
const STORAGE_KEY = 'infinote-state'

let doubleTapDetected = false

// Initialize the app
async function init() {
  // Disable transition during initialization to prevent animation
  world.style.transition = 'none'

  try {
    await initStorage()
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

  // Check if backup reminder is needed
  checkBackupReminder()

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

  // Touch events for mobile pinch-to-zoom
  viewport.addEventListener('touchstart', handleTouchStart, { passive: false })
  viewport.addEventListener('touchmove', handleTouchMove, { passive: false })
  viewport.addEventListener('touchend', handleTouchEnd, { passive: false })

  // Prevent context menu
  viewport.addEventListener('contextmenu', e => e.preventDefault())

  // Window resize
  window.addEventListener('resize', updateTransform)

  // Double-tap detection for mobile
  viewport.addEventListener('touchend', handleTouchTap, { passive: false })

  // Tap-to-create-note detection for mobile
  viewport.addEventListener('touchstart', handleViewportTouchStart, {
    passive: false,
  })
  viewport.addEventListener('touchmove', handleViewportTouchMove, {
    passive: false,
  })
  viewport.addEventListener('touchend', handleViewportTouchEnd, {
    passive: false,
  })

  // Global mouse handlers for note interactions
  document.addEventListener('mousemove', handleGlobalMouseMove)
  document.addEventListener('mouseup', handleGlobalMouseUp)

  // Global touch handlers for note interactions
  document.addEventListener('touchmove', handleGlobalTouchMove, {
    passive: false,
  })
  document.addEventListener('touchend', handleGlobalTouchEnd, {
    passive: false,
  })

  // Drag and drop backup import
  viewport.addEventListener('dragover', handleDragOver, { passive: false })
  viewport.addEventListener('drop', handleDrop, { passive: false })
  viewport.addEventListener('dragenter', handleDragEnter, { passive: false })
  viewport.addEventListener('dragleave', handleDragLeave, { passive: false })
}

// Drag and drop handlers for backup import
let dragCounter = 0

function handleDragEnter(e) {
  e.preventDefault()
  dragCounter++
  if (dragCounter === 1) {
    viewport.classList.add('drag-over')
    showDropOverlay()
  }
}

function handleDragLeave(e) {
  e.preventDefault()
  dragCounter--
  if (dragCounter === 0) {
    viewport.classList.remove('drag-over')
    hideDropOverlay()
  }
}

function handleDragOver(e) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
}

function handleDrop(e) {
  e.preventDefault()
  dragCounter = 0
  viewport.classList.remove('drag-over')
  hideDropOverlay()

  const files = Array.from(e.dataTransfer.files)
  const jsonFile = files.find(
    file => file.type === 'application/json' || file.name.endsWith('.json'),
  )

  if (jsonFile) {
    if (confirm('Import backup file? This will replace all current notes.')) {
      importData(jsonFile)
        .then(() => {
          console.log('✅ Backup imported successfully')
        })
        .catch(error => {
          console.error('❌ Failed to import backup:', error)
          alert('Failed to import backup file. Please check the file format.')
        })
    }
  } else {
    alert('Please drop a JSON backup file.')
  }
}

function showDropOverlay() {
  let overlay = document.getElementById('drop-overlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'drop-overlay'
    overlay.innerHTML = `
      <div class="drop-message">
        <div class="drop-icon">📁</div>
        <div>Drop backup file to import</div>
      </div>
    `
    document.body.appendChild(overlay)
  }
  overlay.style.display = 'flex'
}

function hideDropOverlay() {
  const overlay = document.getElementById('drop-overlay')
  if (overlay) {
    overlay.style.display = 'none'
  }
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
  if (
    deltaX < 5 &&
    deltaY < 5 &&
    (e.target === viewport || e.target === world) &&
    !isColorPickerOpen
  ) {
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
  const zoomDelta = e.deltaY > 0 ? (-ZOOM_FACTOR * state.zoom) / 2 : (ZOOM_FACTOR * state.zoom) / 2
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom + zoomDelta))

  // Calculate new pan to keep mouse position constant in world space
  state.panX = mouseX - worldX * newZoom
  state.panY = mouseY - worldY * newZoom
  state.zoom = newZoom

  updateTransform()
  updateUI()
  saveState()
}

// Touch event handlers for pinch-to-zoom and panning
function handleTouchStart(e) {
  touches = Array.from(e.touches)

  if (touches.length === 2) {
    // Start pinch gesture
    isPinching = true
    isTouchPanning = false // Stop panning when pinching starts
    lastPinchDistance = getPinchDistance(touches[0], touches[1])

    // Initialize pinch center tracking
    const rect = viewport.getBoundingClientRect()
    lastPinchCenter.x = (touches[0].clientX + touches[1].clientX) / 2 - rect.left
    lastPinchCenter.y = (touches[0].clientY + touches[1].clientY) / 2 - rect.top

    e.preventDefault()
  } else if (touches.length === 1 && (e.target === viewport || e.target === world)) {
    // Start single-finger panning
    isTouchPanning = true
    touchPanStart.x = touches[0].clientX
    touchPanStart.y = touches[0].clientY
    touchLastPan.x = state.panX
    touchLastPan.y = state.panY
    viewport.classList.add('dragging')
    e.preventDefault()
  }
}

function handleTouchMove(e) {
  if (isPinching && e.touches.length === 2) {
    e.preventDefault()

    const touch1 = e.touches[0]
    const touch2 = e.touches[1]
    const pinchDistance = getPinchDistance(touch1, touch2)

    if (lastPinchDistance > 0) {
      // Calculate zoom change based on pinch distance change
      const zoomRatio = pinchDistance / lastPinchDistance
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom * zoomRatio))

      // Calculate center point of pinch
      const rect = viewport.getBoundingClientRect()
      const centerX = (touch1.clientX + touch2.clientX) / 2 - rect.left
      const centerY = (touch1.clientY + touch2.clientY) / 2 - rect.top

      // Calculate center point movement (panning while pinching)
      const centerDeltaX = centerX - lastPinchCenter.x
      const centerDeltaY = centerY - lastPinchCenter.y

      // Calculate world coordinates before zoom
      const worldX = (centerX - state.panX) / state.zoom
      const worldY = (centerY - state.panY) / state.zoom

      // Update zoom and pan to keep pinch center constant
      state.panX = centerX - worldX * newZoom + centerDeltaX
      state.panY = centerY - worldY * newZoom + centerDeltaY
      state.zoom = newZoom

      // Update last pinch center for next frame
      lastPinchCenter.x = centerX
      lastPinchCenter.y = centerY

      updateTransform()
      updateUI()
    }

    lastPinchDistance = pinchDistance
  } else if (isTouchPanning && e.touches.length === 1) {
    e.preventDefault()

    const touch = e.touches[0]
    const deltaX = touch.clientX - touchPanStart.x
    const deltaY = touch.clientY - touchPanStart.y

    state.panX = touchLastPan.x + deltaX
    state.panY = touchLastPan.y + deltaY

    updateTransform()
  }
}

function handleTouchEnd(e) {
  if (isPinching) {
    isPinching = false
    lastPinchDistance = 0
    saveState()
  }

  if (isTouchPanning) {
    isTouchPanning = false
    viewport.classList.remove('dragging')
    saveState()
  }

  touches = Array.from(e.touches)

  // If there are still touches remaining, check if we should start a new gesture
  if (touches.length === 1 && !isPinching) {
    // Single touch remains, restart panning if on viewport/world
    const remainingTouch = touches[0]
    if (
      document.elementFromPoint(remainingTouch.clientX, remainingTouch.clientY) === viewport ||
      document.elementFromPoint(remainingTouch.clientX, remainingTouch.clientY) === world
    ) {
      isTouchPanning = true
      touchPanStart.x = remainingTouch.clientX
      touchPanStart.y = remainingTouch.clientY
      touchLastPan.x = state.panX
      touchLastPan.y = state.panY
      viewport.classList.add('dragging')
    }
  }
}

// Helper function to calculate distance between two touch points
function getPinchDistance(touch1, touch2) {
  const dx = touch1.clientX - touch2.clientX
  const dy = touch1.clientY - touch2.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

// Global mouse handlers for note interactions
function handleGlobalMouseMove(e) {
  if (isResizingNote && noteResizeData && currentNote) {
    // Calculate mouse delta from initial position
    const deltaX = e.clientX - noteResizeData.startMouseX
    const deltaY = e.clientY - noteResizeData.startMouseY

    // Apply delta to initial size, accounting for zoom
    const newWidth = Math.max(150, noteResizeData.startWidth + deltaX / state.zoom)
    const newHeight = Math.max(150, noteResizeData.startHeight + deltaY / state.zoom)

    // Update the container size (world coordinates)
    noteResizeData.container.style.width = `${newWidth}px`
    noteResizeData.container.style.height = `${newHeight}px`

    // Update the note data
    currentNote.width = newWidth
    currentNote.height = newHeight
    return
  }

  if (isDraggingNote && noteDragData && currentNote) {
    noteDragData.hasMoved = true
    noteDragData.noteElement.style.cursor = 'grabbing'

    const rect = viewport.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    // Convert to world coordinates and maintain the click offset
    const worldX = (mouseX - noteDragData.dragOffset.x - state.panX) / state.zoom
    const worldY = (mouseY - noteDragData.dragOffset.y - state.panY) / state.zoom

    currentNote.x = worldX
    currentNote.y = worldY
    noteDragData.container.style.left = `${worldX}px`
    noteDragData.container.style.top = `${worldY}px`
    e.preventDefault()
  }
}

function handleGlobalMouseUp() {
  if (isResizingNote && noteResizeData && currentNote) {
    isResizingNote = false

    // Snap resize to 10x10 grid
    const gridSize = 10
    const snappedWidth = Math.round(currentNote.width / gridSize) * gridSize
    const snappedHeight = Math.round(currentNote.height / gridSize) * gridSize

    // Update note size to snapped coordinates
    currentNote.width = Math.max(150, snappedWidth)
    currentNote.height = Math.max(150, snappedHeight)
    noteResizeData.container.style.width = `${currentNote.width}px`
    noteResizeData.container.style.height = `${currentNote.height}px`

    noteResizeData.noteElement.style.cursor = noteResizeData.noteElement.matches(':focus')
      ? 'text'
      : 'grab'
    noteResizeData = null
    currentNote = null
    saveState()
  }

  if (isDraggingNote && noteDragData && currentNote) {
    isDraggingNote = false
    noteDragData.noteElement.style.cursor = ''
    noteDragData.noteElement.style.userSelect = ''

    if (noteDragData.hasMoved) {
      // Snap to 10x10 grid
      const gridSize = 10
      const snappedX = Math.round(currentNote.x / gridSize) * gridSize
      const snappedY = Math.round(currentNote.y / gridSize) * gridSize

      // Update note position to snapped coordinates
      currentNote.x = snappedX
      currentNote.y = snappedY
      noteDragData.container.style.left = `${snappedX}px`
      noteDragData.container.style.top = `${snappedY}px`

      saveState()
    } else {
      // If didn't move, focus the textarea for editing
      setTimeout(() => {
        noteDragData.noteElement.focus()
      }, 10)
    }

    noteDragData = null
    currentNote = null
  }
}

// Global touch handlers for note interactions
function handleGlobalTouchMove(e) {
  if (isResizingNote && noteResizeData && currentNote && e.touches.length === 1) {
    const touch = e.touches[0]
    const deltaX = touch.clientX - noteResizeData.startTouchX
    const deltaY = touch.clientY - noteResizeData.startTouchY

    const newWidth = Math.max(150, noteResizeData.startWidth + deltaX / state.zoom)
    const newHeight = Math.max(150, noteResizeData.startHeight + deltaY / state.zoom)

    noteResizeData.container.style.width = `${newWidth}px`
    noteResizeData.container.style.height = `${newHeight}px`
    currentNote.width = newWidth
    currentNote.height = newHeight
    e.preventDefault()
    return
  }

  if (isDraggingNote && noteDragData && currentNote && e.touches.length === 1) {
    noteDragData.hasMoved = true
    noteDragData.noteElement.style.cursor = 'grabbing'

    const rect = viewport.getBoundingClientRect()
    const touch = e.touches[0]
    const mouseX = touch.clientX - rect.left
    const mouseY = touch.clientY - rect.top

    // Convert to world coordinates and maintain the click offset
    const worldX = (mouseX - noteDragData.dragOffset.x - state.panX) / state.zoom
    const worldY = (mouseY - noteDragData.dragOffset.y - state.panY) / state.zoom

    currentNote.x = worldX
    currentNote.y = worldY
    noteDragData.container.style.left = `${worldX}px`
    noteDragData.container.style.top = `${worldY}px`
    e.preventDefault()
  }
}

function handleGlobalTouchEnd(e) {
  if (isResizingNote && noteResizeData && currentNote) {
    isResizingNote = false

    // Snap resize to 10x10 grid
    const gridSize = 10
    const snappedWidth = Math.round(currentNote.width / gridSize) * gridSize
    const snappedHeight = Math.round(currentNote.height / gridSize) * gridSize

    // Update note size to snapped coordinates
    currentNote.width = Math.max(150, snappedWidth)
    currentNote.height = Math.max(150, snappedHeight)
    noteResizeData.container.style.width = `${currentNote.width}px`
    noteResizeData.container.style.height = `${currentNote.height}px`

    noteResizeData.noteElement.style.cursor = noteResizeData.noteElement.matches(':focus')
      ? 'text'
      : 'grab'
    noteResizeData = null
    currentNote = null
    saveState()
  }

  if (isDraggingNote && noteDragData && currentNote) {
    isDraggingNote = false
    noteDragData.noteElement.style.cursor = ''
    noteDragData.noteElement.style.userSelect = ''

    if (noteDragData.hasMoved) {
      // Snap to 10x10 grid
      const gridSize = 10
      const snappedX = Math.round(currentNote.x / gridSize) * gridSize
      const snappedY = Math.round(currentNote.y / gridSize) * gridSize

      // Update note position to snapped coordinates
      currentNote.x = snappedX
      currentNote.y = snappedY
      noteDragData.container.style.left = `${snappedX}px`
      noteDragData.container.style.top = `${snappedY}px`

      saveState()
    } else {
      // If didn't move, focus the textarea for editing
      setTimeout(() => {
        noteDragData.noteElement.focus()
      }, 10)
    }

    noteDragData = null
    currentNote = null
  }
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
    zIndex: ++state.maxZIndex,
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
    'rgba(255, 255, 255, 0.95)', // White
    'rgba(255, 200, 200, 0.95)', // Soft red
    'rgba(255, 220, 170, 0.95)', // Soft orange
    'rgba(255, 245, 157, 0.95)', // Soft yellow
    'rgba(200, 255, 200, 0.95)', // Soft green
    'rgba(173, 216, 230, 0.95)', // Soft blue
    'rgba(221, 160, 221, 0.95)', // Soft purple
    'rgba(255, 182, 193, 0.95)', // Soft pink
    'rgba(255, 218, 185, 0.95)', // Soft peach
    'rgba(211, 211, 211, 0.95)', // Light gray
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
  document.addEventListener('click', e => {
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

  // Mouse-based resize
  container.addEventListener('mousedown', e => {
    bringToFront()

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // Don't handle clicks on color or delete buttons
    if (e.target === colorBtn || e.target === deleteBtn || colorPalette.contains(e.target)) {
      return
    }

    // Check if clicking in bottom-right resize handle area (40x40 px)
    if (x > rect.width - 40 && y > rect.height - 40) {
      isResizingNote = true
      currentNote = note
      noteResizeData = {
        startWidth: note.width,
        startHeight: note.height,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        container: container,
        noteElement: noteElement,
      }
      noteElement.style.cursor = 'nw-resize'
      e.preventDefault()
      e.stopPropagation()
      return
    }

    e.stopPropagation()
  })

  // Touch-based resize
  container.addEventListener(
    'touchstart',
    function (e) {
      if (e.touches.length !== 1) return
      bringToFront()
      const rect = container.getBoundingClientRect()
      const touch = e.touches[0]
      const x = touch.clientX - rect.left
      const y = touch.clientY - rect.top
      if (x > rect.width - 40 && y > rect.height - 40) {
        isResizingNote = true
        currentNote = note
        noteResizeData = {
          startWidth: note.width,
          startHeight: note.height,
          startTouchX: touch.clientX,
          startTouchY: touch.clientY,
          container: container,
          noteElement: noteElement,
        }
        noteElement.style.cursor = 'nw-resize'
        e.preventDefault()
        e.stopPropagation()
      }
    },
    { passive: false },
  )

  // Mouse-based interaction (tap to focus vs drag to move)
  let noteMouseData = null
  const NOTE_DRAG_THRESHOLD = 5 // pixels

  noteElement.addEventListener('mousedown', e => {
    if (isResizingNote) return

    // If already focused, let textarea handle mouse normally
    if (noteElement.matches(':focus')) return

    // Don't start interaction if clicking buttons
    if (e.target === colorBtn || e.target === deleteBtn || colorPalette.contains(e.target)) {
      return
    }

    // Start tracking the interaction
    const rect = container.getBoundingClientRect()
    noteMouseData = {
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      dragOffset: {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      },
      container: container,
      noteElement: noteElement,
      wasFocused: noteElement.matches(':focus'),
      hasMoved: false,
      isDragging: false,
    }

    noteElement.style.userSelect = 'none'
    e.preventDefault()
  })

  noteElement.addEventListener('mousemove', e => {
    if (!noteMouseData) return

    const deltaX = Math.abs(e.clientX - noteMouseData.startX)
    const deltaY = Math.abs(e.clientY - noteMouseData.startY)

    // If movement exceeds threshold and not already dragging, start drag
    if (
      (deltaX > NOTE_DRAG_THRESHOLD || deltaY > NOTE_DRAG_THRESHOLD) &&
      !noteMouseData.isDragging
    ) {
      noteMouseData.isDragging = true
      noteMouseData.hasMoved = true
      isDraggingNote = true
      currentNote = note
      noteDragData = {
        hasMoved: true,
        dragOffset: noteMouseData.dragOffset,
        container: noteMouseData.container,
        noteElement: noteMouseData.noteElement,
      }
      noteElement.style.cursor = 'grabbing'
    }
  })

  noteElement.addEventListener('mouseup', e => {
    if (!noteMouseData) return

    // If no significant movement occurred, it's a tap
    if (!noteMouseData.hasMoved) {
      // Only focus if textarea wasn't already focused
      if (!noteMouseData.wasFocused) {
        noteElement.focus()
      }
    }

    // Reset tracking
    noteMouseData = null
    noteElement.style.userSelect = ''
  })

  // Touch-based interaction (tap to focus vs drag to move)
  let noteTouchData = null
  const NOTE_TOUCH_DRAG_THRESHOLD = 10 // pixels (slightly higher for touch)

  noteElement.addEventListener(
    'touchstart',
    function (e) {
      if (isResizingNote || e.touches.length !== 1) return
      // Don't start interaction if touching buttons or palette
      if (e.target === colorBtn || e.target === deleteBtn || colorPalette.contains(e.target)) {
        return
      }
      // Don't start interaction if in resize area
      const rect = container.getBoundingClientRect()
      const touch = e.touches[0]
      const x = touch.clientX - rect.left
      const y = touch.clientY - rect.top
      if (x > rect.width - 40 && y > rect.height - 40) return

      // Start tracking the touch interaction
      noteTouchData = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        dragOffset: {
          x: touch.clientX - rect.left,
          y: touch.clientY - rect.top,
        },
        container: container,
        noteElement: noteElement,
        wasFocused: noteElement.matches(':focus'),
        hasMoved: false,
        isDragging: false,
      }

      noteElement.style.userSelect = 'none'
      e.preventDefault()
    },
    { passive: false },
  )

  noteElement.addEventListener(
    'touchmove',
    function (e) {
      if (!noteTouchData || e.touches.length !== 1) return

      const touch = e.touches[0]
      const deltaX = Math.abs(touch.clientX - noteTouchData.startX)
      const deltaY = Math.abs(touch.clientY - noteTouchData.startY)

      // If movement exceeds threshold and not already dragging, start drag
      if (
        (deltaX > NOTE_TOUCH_DRAG_THRESHOLD || deltaY > NOTE_TOUCH_DRAG_THRESHOLD) &&
        !noteTouchData.isDragging
      ) {
        noteTouchData.isDragging = true
        noteTouchData.hasMoved = true
        isDraggingNote = true
        currentNote = note
        noteDragData = {
          hasMoved: true,
          dragOffset: noteTouchData.dragOffset,
          container: noteTouchData.container,
          noteElement: noteTouchData.noteElement,
        }
        noteElement.style.cursor = 'grabbing'
      }
    },
    { passive: false },
  )

  noteElement.addEventListener(
    'touchend',
    function (e) {
      if (!noteTouchData) return

      // If no significant movement occurred, it's a tap
      if (!noteTouchData.hasMoved) {
        // Only focus if textarea wasn't already focused
        if (!noteTouchData.wasFocused) {
          noteElement.focus()
        }
      }

      // Reset tracking
      noteTouchData = null
      noteElement.style.userSelect = ''
    },
    { passive: false },
  )

  // Cursor management for resize handle
  container.addEventListener('mousemove', e => {
    if (isDraggingNote || isResizingNote) return

    const rect = container.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    if (x > rect.width - 40 && y > rect.height - 40) {
      noteElement.style.cursor = 'nw-resize'
    } else if (noteElement.matches(':focus')) {
      noteElement.style.cursor = 'text'
    } else {
      noteElement.style.cursor = 'grab'
    }
  })

  container.addEventListener('mouseleave', () => {
    if (!isDraggingNote && !isResizingNote) {
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

    request.onupgradeneeded = event => {
      const db = event.target.result
      if (!db.objectStoreNames.contains('state')) {
        db.createObjectStore('state', { keyPath: 'id' })
      }
    }
  })
}

// Request persistent storage to prevent data loss
async function requestPersistentStorage() {
  if ('storage' in navigator && 'persist' in navigator.storage) {
    try {
      const persistent = await navigator.storage.persist()
      if (persistent) {
        console.log('✓ Persistent storage granted - your data is protected')
      } else {
        console.warn('⚠ Persistent storage denied - data may be cleared by browser')
      }
      return persistent
    } catch (error) {
      console.warn('Failed to request persistent storage:', error)
      return false
    }
  } else {
    console.warn('Persistent storage API not supported')
    return false
  }
}

// Monitor storage usage and quota
async function checkStorageQuota() {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate()
      const usedMB = Math.round((estimate.usage || 0) / 1024 / 1024)
      const quotaMB = Math.round((estimate.quota || 0) / 1024 / 1024)
      const usagePercent = estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0

      console.log(`Storage: ${usedMB}MB used of ${quotaMB}MB (${usagePercent}%)`)

      // Warn if storage is getting full (over 80%)
      if (usagePercent > 80) {
        console.warn('⚠ Storage quota is getting full - consider backing up your notes')
      }

      return {
        used: estimate.usage,
        quota: estimate.quota,
        percent: usagePercent,
      }
    } catch (error) {
      console.warn('Failed to check storage quota:', error)
      return null
    }
  } else {
    console.warn('Storage estimate API not supported')
    return null
  }
}

// Check if storage is persistent
async function checkStoragePersistence() {
  if ('storage' in navigator && 'persisted' in navigator.storage) {
    try {
      const persistent = await navigator.storage.persisted()
      console.log(persistent ? '✓ Storage is persistent' : '⚠ Storage is not persistent')
      return persistent
    } catch (error) {
      console.warn('Failed to check storage persistence:', error)
      return false
    }
  } else {
    return false
  }
}

// Enhanced storage initialization
async function initStorage() {
  console.log('🔧 Initializing storage...')

  // Check current storage status
  await checkStoragePersistence()
  await checkStorageQuota()

  // Request persistent storage
  const persistent = await requestPersistentStorage()

  // Initialize IndexedDB
  await initDB()

  // Set up storage monitoring
  if ('storage' in navigator) {
    // Monitor storage changes (if supported)
    try {
      // Some browsers support storage event listeners
      if ('addEventListener' in navigator.storage) {
        navigator.storage.addEventListener('quotachange', () => {
          console.log('Storage quota changed')
          checkStorageQuota()
        })
      }
    } catch (error) {
      // Ignore if not supported
    }
  }

  return { persistent, db }
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

// Export data for backup
function exportData() {
  const exportData = {
    version: 1,
    exported: new Date().toISOString(),
    state: state,
  }

  const dataStr = JSON.stringify(exportData, null, 2)
  const dataBlob = new Blob([dataStr], { type: 'application/json' })

  const link = document.createElement('a')
  link.href = URL.createObjectURL(dataBlob)
  link.download = `infinote-backup-${new Date().toISOString().split('T')[0]}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  console.log('📁 Data exported successfully')

  // Update last backup time
  localStorage.setItem('infinote-last-backup', Date.now().toString())
}

// Import data from backup
function importData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async e => {
      try {
        const importData = JSON.parse(e.target.result)

        if (importData.version && importData.state) {
          // Clear existing notes
          document.querySelectorAll('.note-container').forEach(container => container.remove())

          // Load imported state
          state = { ...state, ...importData.state }

          // Render imported notes
          state.notes.forEach(note => renderNote(note))

          updateTransform()
          updateUI()
          await saveState()

          console.log('📥 Data imported successfully')
          resolve(true)
        } else {
          throw new Error('Invalid backup file format')
        }
      } catch (error) {
        console.error('Failed to import data:', error)
        reject(error)
      }
    }
    reader.readAsText(file)
  })
}

// Check if backup reminder is needed
function checkBackupReminder() {
  // Only suggest backup if there are notes
  if (state.notes.length === 0) return

  const lastBackup = localStorage.getItem('infinote-last-backup')
  const backupReminderShown = localStorage.getItem('infinote-backup-reminder-shown')
  const now = Date.now()

  // Suggest backup if:
  // 1. Never backed up and has notes for 24+ hours, or
  // 2. Last backup was 30+ days ago
  const shouldRemind = !lastBackup
    ? now - (state.notes[0]?.id || now) > 24 * 60 * 60 * 1000 // 24 hours since first note
    : now - parseInt(lastBackup) > 30 * 24 * 60 * 60 * 1000 // 30 days since last backup

  if (shouldRemind && !backupReminderShown) {
    console.log('💾 Consider backing up your notes - check console for exportData() function')
    localStorage.setItem('infinote-backup-reminder-shown', now.toString())
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

// Double-tap detection for mobile
function handleTouchTap(e) {
  if (e.touches.length > 0) return // Only handle single-finger tap
  const now = Date.now()
  const touch = e.changedTouches[0]
  const x = touch.clientX
  const y = touch.clientY
  if (
    now - lastTapTime < DOUBLE_TAP_DELAY &&
    Math.abs(x - lastTapX) < DOUBLE_TAP_DISTANCE &&
    Math.abs(y - lastTapY) < DOUBLE_TAP_DISTANCE
  ) {
    // Double tap detected
    if (tapCreateNoteTimer) {
      clearTimeout(tapCreateNoteTimer)
      tapCreateNoteTimer = null
    }
    doubleTapDetected = true
    resetView()
    lastTapTime = 0
    lastTapX = 0
    lastTapY = 0
    e.preventDefault()
  } else {
    lastTapTime = now
    lastTapX = x
    lastTapY = y
  }
}

// Tap-to-create-note detection for mobile
function handleViewportTouchStart(e) {
  if (e.touches.length !== 1) return
  tapStartTime = Date.now()
  tapMoved = false
  tapStartX = e.touches[0].clientX
  tapStartY = e.touches[0].clientY
}

function handleViewportTouchMove(e) {
  if (e.touches.length !== 1) return
  const dx = e.touches[0].clientX - tapStartX
  const dy = e.touches[0].clientY - tapStartY
  if (Math.abs(dx) > TAP_MAX_MOVE || Math.abs(dy) > TAP_MAX_MOVE) {
    tapMoved = true
  }
}

function handleViewportTouchEnd(e) {
  // Only fire if not a pan and not on a note
  if (e.changedTouches.length !== 1) return
  if (tapMoved) return
  const now = Date.now()
  if (now - tapStartTime > TAP_MAX_DURATION) return
  // Only on viewport/world
  const touch = e.changedTouches[0]
  const target = document.elementFromPoint(touch.clientX, touch.clientY)
  if (target !== viewport && target !== world) return
  // Start timer to create note after DOUBLE_TAP_DELAY
  tapCreateNotePosition.x = touch.clientX
  tapCreateNotePosition.y = touch.clientY
  if (tapCreateNoteTimer) clearTimeout(tapCreateNoteTimer)
  tapCreateNoteTimer = setTimeout(() => {
    if (!doubleTapDetected) {
      // If a textarea is focused, blur it and do not create a note
      const focusedTextarea = document.querySelector('textarea.note:focus')
      if (focusedTextarea) {
        focusedTextarea.blur()
      } else {
        createNoteAtPosition(tapCreateNotePosition.x, tapCreateNotePosition.y)
      }
    }
    doubleTapDetected = false
    tapCreateNoteTimer = null
  }, DOUBLE_TAP_DELAY)
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
window.exportData = exportData
window.importData = importData
