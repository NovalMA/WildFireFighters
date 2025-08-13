'use client'

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import * as THREE from 'three'

import { sdk } from '@farcaster/miniapp-sdk'

interface Vector3 {
  x: number
  y: number
  z: number
}

interface Player {
  position: Vector3
  rotation: number
  waterLevel: number
  maxWater: number
  isRefilling: boolean
  mesh?: THREE.Mesh
}

interface FireCell {
  x: number
  z: number
  intensity: number
  spreadTime: number
  mesh?: THREE.Points
}

interface RefillStation {
  position: Vector3
  radius: number
  mesh?: THREE.Mesh
}

interface GameState {
  player: Player
  fires: Map<string, FireCell>
  refillStations: RefillStation[]
  gameStatus: 'playing' | 'won' | 'lost' | 'tutorial'
  windDirection: Vector3
  windSpeed: number
  timeElapsed: number
  gameSpeed: number
  trees: { x: number; z: number; radius: number }[]
}

interface MobileControl {
  type: 'joystick' | 'button'
  position: { x: number; y: number }
  size: number
  active: boolean
}

const WORLD_SIZE = 40
const GRID_SIZE = 2
const PLAYER_HEIGHT = 1.8
const WATER_RANGE = 8
const REFILL_RATE = 2
const FIRE_SPREAD_RATE = 4.0 // Even slower fire spread initially
const INITIAL_FIRES = 5 // number of initial fires
const CAMERA_DISTANCE = 10
const CAMERA_HEIGHT = 8

export default function WildFireFighters(): JSX.Element {
  useEffect(() => {
    const initializeFarcaster = async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 100))
        
        if (document.readyState !== 'complete') {
          await new Promise(resolve => {
            if (document.readyState === 'complete') {
              resolve(void 0)
            } else {
              window.addEventListener('load', () => resolve(void 0), { once: true })
            }
          })
        }
        
        await sdk.actions.ready()
        console.log('Farcaster SDK initialized successfully - app fully loaded')
      } catch (error) {
        console.error('Failed to initialize Farcaster SDK:', error)
        setTimeout(async () => {
          try {
            await sdk.actions.ready()
            console.log('Farcaster SDK initialized on retry')
          } catch (retryError) {
            console.error('Farcaster SDK retry failed:', retryError)
          }
        }, 1000)
      }
    }

    initializeFarcaster()
  }, [])

  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene>()
  const rendererRef = useRef<THREE.WebGLRenderer>()
  const cameraRef = useRef<THREE.PerspectiveCamera>()
  const gameLoopRef = useRef<number>(0)
  const keysRef = useRef<Set<string>>(new Set())
  const mouseRef = useRef<{ x: number; y: number; isDragging: boolean }>({ x: 0, y: 0, isDragging: false })
  const waterParticlesRef = useRef<THREE.Points>()
  const [isMobile, setIsMobile] = useState<boolean>(false)
  const [showTutorial, setShowTutorial] = useState<boolean>(true)
  const [fps, setFps] = useState<number>(60)
  const lastFrameTimeRef = useRef<number>(0)
  const frameCountRef = useRef<number>(0)
  const fpsUpdateTimeRef = useRef<number>(0)

  const [gameState, setGameState] = useState<GameState>({
    player: {
      position: { x: 0, y: 0, z: 0 },
      rotation: 0,
      waterLevel: 100,
      maxWater: 100,
      isRefilling: false
    },
    fires: new Map(),
    refillStations: [
      { position: { x: -15, y: 0, z: -15 }, radius: 3 },
      { position: { x: 15, y: 0, z: -15 }, radius: 3 },
      { position: { x: -15, y: 0, z: 15 }, radius: 3 },
      { position: { x: 15, y: 0, z: 15 }, radius: 3 }
    ],
    gameStatus: 'tutorial',
    windDirection: { x: 0.7, y: 0, z: 0.3 },
    windSpeed: 1.2,
    timeElapsed: 0,
    gameSpeed: 1,
    trees: []
  })

  const [mobileControls, setMobileControls] = useState<{
    joystick: MobileControl
    shootButton: MobileControl
    refillButton: MobileControl
  }>({
    joystick: {
      type: 'joystick',
      position: { x: 80, y: window.innerHeight - 80 },
      size: 60,
      active: false
    },
    shootButton: {
      type: 'button',
      position: { x: window.innerWidth - 80, y: window.innerHeight - 100 },
      size: 40,
      active: false
    },
    refillButton: {
      type: 'button',
      position: { x: window.innerWidth - 80, y: window.innerHeight - 50 },
      size: 40,
      active: false
    }
  })

  // Initialize Three.js scene
  const initScene = useCallback((): void => {
    if (!mountRef.current) return

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x87CEEB) // Sky blue
    scene.fog = new THREE.Fog(0x87CEEB, 30, 100)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
    camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(window.innerWidth, window.innerHeight)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    rendererRef.current = renderer
    mountRef.current.appendChild(renderer.domElement)

    // Lights
    const ambientLight = new THREE.AmbientLight(0x404040, 0.6)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(20, 20, 20)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 50
    directionalLight.shadow.camera.left = -25
    directionalLight.shadow.camera.right = 25
    directionalLight.shadow.camera.top = 25
    directionalLight.shadow.camera.bottom = -25
    scene.add(directionalLight)

    // Ground
    const groundGeometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE)
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x3d6b2e })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)

    // Player
    const playerGeometry = new THREE.CapsuleGeometry(0.5, PLAYER_HEIGHT)
    const playerMaterial = new THREE.MeshLambertMaterial({ color: 0xff6b35 })
    const playerMesh = new THREE.Mesh(playerGeometry, playerMaterial)
    playerMesh.position.set(0, PLAYER_HEIGHT / 2, 0)
    playerMesh.castShadow = true
    scene.add(playerMesh)

    setGameState(prev => ({
      ...prev,
      player: { ...prev.player, mesh: playerMesh }
    }))

    // Initialize refill stations
    gameState.refillStations.forEach((station) => {
      const stationGeometry = new THREE.CylinderGeometry(station.radius, station.radius, 0.5, 16)
      const stationMaterial = new THREE.MeshLambertMaterial({ color: 0x4a90e2 })
      const stationMesh = new THREE.Mesh(stationGeometry, stationMaterial)
      stationMesh.position.set(station.position.x, 0.1, station.position.z) // Slightly raised for visibility
      stationMesh.castShadow = true
      stationMesh.receiveShadow = true
      scene.add(stationMesh)
      station.mesh = stationMesh
    })

    // Generate initial random trees using the function
    const trees = generateTrees(gameState.refillStations)
    
    // Create 3D tree meshes in the scene
    trees.forEach(tree => {
      const treeHeight = Math.random() * 3 + 4 // 4-7 units tall
      const fullRadius = tree.radius / 0.8 // Convert back from collision radius
      
      // Tree trunk
      const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.3, 1.5, 8)
      const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 }) // Brown
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial)
      trunk.position.set(tree.x, 0.75, tree.z)
      trunk.castShadow = true
      trunk.receiveShadow = true
      trunk.userData = { isTree: true } // Mark for easy cleanup
      scene.add(trunk)
      
      // Tree foliage (green cone)
      const foliageGeometry = new THREE.ConeGeometry(fullRadius, treeHeight, 8)
      const foliageMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 }) // Forest green
      const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial)
      foliage.position.set(tree.x, 1.5 + treeHeight / 2, tree.z)
      foliage.castShadow = true
      foliage.receiveShadow = true
      foliage.userData = { isTree: true } // Mark for easy cleanup
      scene.add(foliage)
    })
    
    // Update game state with tree positions
    setGameState(prev => ({ ...prev, trees }))

    // Water particles system for shooting effect
    const particleGeometry = new THREE.BufferGeometry()
    const particleCount = 100
    const positions = new Float32Array(particleCount * 3)
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    
    const particleMaterial = new THREE.PointsMaterial({
      color: 0x87CEEB,
      size: 0.1,
      transparent: true,
      opacity: 0.8
    })
    
    const waterParticles = new THREE.Points(particleGeometry, particleMaterial)
    waterParticles.visible = false
    scene.add(waterParticles)
    waterParticlesRef.current = waterParticles

    // Handle window resize
    const handleResize = (): void => {
      if (!camera || !renderer) return
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    }
    window.addEventListener('resize', handleResize)
  }, [gameState.refillStations])

  // Generate random trees with collision avoidance
  const generateTrees = useCallback((refillStations: RefillStation[]): { x: number; z: number; radius: number }[] => {
    const trees: { x: number; z: number; radius: number }[] = []
    const maxAttempts = 200 // Increased attempts for better coverage
    
    for (let i = 0; i < 40 && trees.length < 40; i++) {
      let attempts = 0
      let placed = false
      
      while (attempts < maxAttempts && !placed) {
        const x = (Math.random() - 0.5) * (WORLD_SIZE - 5)
        const z = (Math.random() - 0.5) * (WORLD_SIZE - 5)
        
        // Check distance from refill stations
        const nearStation = refillStations.some(station => 
          Math.sqrt((x - station.position.x) ** 2 + (z - station.position.z) ** 2) < 5
        )
        
        // Check distance from center
        const nearCenter = Math.sqrt(x ** 2 + z ** 2) < 8
        
        // Check distance from other trees
        const treeRadius = Math.random() * 0.8 + 1
        const nearOtherTree = trees.some(tree => 
          Math.sqrt((x - tree.x) ** 2 + (z - tree.z) ** 2) < (tree.radius + treeRadius + 1)
        )
        
        if (!nearStation && !nearCenter && !nearOtherTree) {
          trees.push({ x, z, radius: treeRadius * 0.8 })
          placed = true
        }
        
        attempts++
      }
    }
    
    return trees
  }, [])

  // Initialize fires with realistic spherical particles
  const initializeFires = useCallback((): Map<string, FireCell> => {
    const fires = new Map<string, FireCell>()
    const scene = sceneRef.current
    if (!scene) return fires

    for (let i = 0; i < INITIAL_FIRES; i++) {
      let attempts = 0
      let placed = false
      let x: number = (Math.random() - 0.5) * (WORLD_SIZE - 10)
      let z: number = (Math.random() - 0.5) * (WORLD_SIZE - 10)
      let key: string = `${Math.floor(x / GRID_SIZE)}-${Math.floor(z / GRID_SIZE)}`
      
      // Try to place fire avoiding overlap and ensuring good distribution
      while (attempts < 100 && !placed) {
        x = (Math.random() - 0.5) * (WORLD_SIZE - 10)
        z = (Math.random() - 0.5) * (WORLD_SIZE - 10)
        key = `${Math.floor(x / GRID_SIZE)}-${Math.floor(z / GRID_SIZE)}`
        
        // Check if position is already occupied
        if (!fires.has(key)) {
          // Check minimum distance from other fires for better spread
          let minDistance = Infinity
          for (const existingFire of fires.values()) {
            const distance = Math.sqrt((x - existingFire.x) ** 2 + (z - existingFire.z) ** 2)
            minDistance = Math.min(minDistance, distance)
          }
          
          if (fires.size === 0 || minDistance > 6) { // Minimum 6 units apart
            placed = true
          }
        }
        
        attempts++
      }
      
      // If placement failed, use fallback position
      if (!placed) {
        x = (Math.random() - 0.5) * (WORLD_SIZE - 10)
        z = (Math.random() - 0.5) * (WORLD_SIZE - 10)
        key = `${Math.floor(x / GRID_SIZE)}-${Math.floor(z / GRID_SIZE)}`
      }
      
      // Create realistic fire with enhanced spherical particle system
      const particleCount = 300
      const fireGeometry = new THREE.BufferGeometry()
      const positions = new Float32Array(particleCount * 3)
      const colors = new Float32Array(particleCount * 3)
      const sizes = new Float32Array(particleCount)

      const fireIntensity = Math.random() * 0.5 + 0.5
      
      for (let p = 0; p < particleCount; p++) {
        // Random positions within fire area
        const radius = Math.random() * 1.5
        const angle = Math.random() * Math.PI * 2
        const height = Math.random() * 3
        
        positions[p * 3] = Math.cos(angle) * radius
        positions[p * 3 + 1] = height
        positions[p * 3 + 2] = Math.sin(angle) * radius
        
        // Fire colors (red to yellow gradient)
        const colorIntensity = Math.random()
        colors[p * 3] = fireIntensity // Red
        colors[p * 3 + 1] = colorIntensity * fireIntensity * 0.8 // Green (for yellow)
        colors[p * 3 + 2] = 0 // Blue
        
        sizes[p] = Math.random() * 3 + 1
      }
      
      fireGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      fireGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      fireGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
      
      const fireMaterial = new THREE.PointsMaterial({
        size: 0.3,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        map: (() => {
          const canvas = document.createElement('canvas')
          canvas.width = 16
          canvas.height = 16
          const context = canvas.getContext('2d')!
          const gradient = context.createRadialGradient(8, 8, 0, 8, 8, 8)
          gradient.addColorStop(0, 'rgba(255,255,255,1)')
          gradient.addColorStop(0.2, 'rgba(255,255,0,1)')
          gradient.addColorStop(0.4, 'rgba(255,128,0,1)')
          gradient.addColorStop(1, 'rgba(255,0,0,0)')
          context.fillStyle = gradient
          context.fillRect(0, 0, 16, 16)
          const texture = new THREE.CanvasTexture(canvas)
          return texture
        })()
      })
      
      const fireMesh = new THREE.Points(fireGeometry, fireMaterial)
      fireMesh.position.set(x, 0, z)
      scene.add(fireMesh)

      fires.set(key, {
        x: Math.floor(x / GRID_SIZE) * GRID_SIZE,
        z: Math.floor(z / GRID_SIZE) * GRID_SIZE,
        intensity: fireIntensity,
        spreadTime: 0,
        mesh: fireMesh
      })
    }
    return fires
  }, [])

  // Check mobile device
  useEffect(() => {
    const checkMobile = (): void => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // Input event handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      keysRef.current.add(e.key.toLowerCase())
      if (e.key === ' ') e.preventDefault()
    }

    const handleKeyUp = (e: KeyboardEvent): void => {
      keysRef.current.delete(e.key.toLowerCase())
    }

    const handlePointerLockChange = (): void => {
      // Handle pointer lock changes
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    document.addEventListener('pointerlockchange', handlePointerLockChange)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      document.removeEventListener('pointerlockchange', handlePointerLockChange)
    }
  }, [gameState.gameStatus])

  // Distance calculation
  const distance3D = (a: Vector3, b: Vector3): number => {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
  }

  // Normalize vector
  const normalize3D = (v: Vector3): Vector3 => {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
    return len > 0 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: 0, z: 0 }
  }

  // Update player movement and actions
  const updatePlayer = (player: Player, deltaTime: number): Player => {
    const baseSpeed = 5
    const rotationSpeed = 0.032
    const keys = keysRef.current
    const newPlayer = { ...player }

    // Arrow key rotation (character facing)
    if (keys.has('arrowleft')) {
      newPlayer.rotation += rotationSpeed * 60 * deltaTime // Turn left
    }
    if (keys.has('arrowright')) {
      newPlayer.rotation -= rotationSpeed * 60 * deltaTime // Turn right
    }

    // Movement
    const moveVector = { x: 0, z: 0 }
    if (keys.has('w')) moveVector.z -= 1
    if (keys.has('s')) moveVector.z += 1
    if (keys.has('a')) moveVector.x -= 1
    if (keys.has('d')) moveVector.x += 1

    if (moveVector.x !== 0 || moveVector.z !== 0) {
      const len = Math.sqrt(moveVector.x * moveVector.x + moveVector.z * moveVector.z)
      moveVector.x /= len
      moveVector.z /= len

      // Rotate movement vector by player rotation
      const cos = Math.cos(newPlayer.rotation)
      const sin = Math.sin(newPlayer.rotation)
      const rotatedX = moveVector.x * cos - moveVector.z * sin
      const rotatedZ = moveVector.x * sin + moveVector.z * cos

      // Calculate new position with collision and speed modifications
      const newX = newPlayer.position.x + rotatedX * baseSpeed * deltaTime
      const newZ = newPlayer.position.z + rotatedZ * baseSpeed * deltaTime
      
      // Check tree collisions - separate trunk (blocking) from foliage (slowing)
      let trunkCollision = false
      let inFoliage = false
      
      for (const tree of gameState.trees) {
        const distanceToTree = Math.sqrt((newX - tree.x) ** 2 + (newZ - tree.z) ** 2)
        
        // Trunk collision (small radius, complete blocking)
        const trunkRadius = 0.4 // Trunk collision radius
        if (distanceToTree < trunkRadius + 1) { // Player has ~1 unit collision radius
          trunkCollision = true
          break
        }
        
        // Foliage collision (larger radius, speed reduction)
        const foliageRadius = tree.radius // Full tree foliage radius
        if (distanceToTree < foliageRadius + 1) {
          inFoliage = true
        }
      }
      
      // Apply movement based on collision type
      if (!trunkCollision) {
        if (inFoliage) {
          // 50% speed reduction in foliage
          const reducedSpeed = baseSpeed * 0.5
          newPlayer.position.x = newPlayer.position.x + rotatedX * reducedSpeed * deltaTime
          newPlayer.position.z = newPlayer.position.z + rotatedZ * reducedSpeed * deltaTime
        } else {
          // Normal speed movement
          newPlayer.position.x = newX
          newPlayer.position.z = newZ
        }
      }

      // Boundary checks
      const halfWorld = WORLD_SIZE / 2 - 2
      newPlayer.position.x = Math.max(-halfWorld, Math.min(halfWorld, newPlayer.position.x))
      newPlayer.position.z = Math.max(-halfWorld, Math.min(halfWorld, newPlayer.position.z))
    }

    // Update player mesh position and rotation
    if (newPlayer.mesh) {
      newPlayer.mesh.position.x = newPlayer.position.x
      newPlayer.mesh.position.z = newPlayer.position.z
      newPlayer.mesh.rotation.y = newPlayer.rotation
    }

    // Water shooting
    if (keys.has(' ') && newPlayer.waterLevel > 0) {
      newPlayer.waterLevel = Math.max(0, newPlayer.waterLevel - 30 * deltaTime)
      
      // Show water particles
      if (waterParticlesRef.current) {
        waterParticlesRef.current.visible = true
        const positions = waterParticlesRef.current.geometry.attributes.position.array as Float32Array
        
        for (let i = 0; i < positions.length; i += 3) {
          const angle = newPlayer.rotation + (Math.random() - 0.5) * 0.5
          const distance = Math.random() * WATER_RANGE
          positions[i] = newPlayer.position.x + Math.sin(angle) * distance
          positions[i + 1] = 1 + Math.random() * 2
          positions[i + 2] = newPlayer.position.z - Math.cos(angle) * distance
        }
        
        waterParticlesRef.current.geometry.attributes.position.needsUpdate = true
      }
    } else {
      // Hide water particles
      if (waterParticlesRef.current) {
        waterParticlesRef.current.visible = false
      }
    }

    // Check refill stations
    newPlayer.isRefilling = false
    for (const station of gameState.refillStations) {
      const distance = distance3D(newPlayer.position, station.position)
      if (distance < station.radius) {
        newPlayer.isRefilling = true
        newPlayer.waterLevel = Math.min(newPlayer.maxWater, newPlayer.waterLevel + REFILL_RATE * deltaTime * 60)
        break
      }
    }

    // Reset mouse movement
    mouseRef.current.x = 0
    mouseRef.current.y = 0

    return newPlayer
  }

  // Update fire spread
  const updateFires = (fires: Map<string, FireCell>, deltaTime: number): Map<string, FireCell> => {
    const newFires = new Map(fires)
    const scene = sceneRef.current
    if (!scene) return newFires

    // Update existing fires
    for (const [key, fire] of newFires) {
      fire.spreadTime += deltaTime
      fire.intensity = Math.min(1, fire.intensity + deltaTime * 0.1)
      console.log(key);

      // Update fire visual intensity for particle system
      if (fire.mesh) {
        // Update particle colors based on intensity
        const geometry = fire.mesh.geometry as THREE.BufferGeometry
        const colors = geometry.attributes.color.array as Float32Array
        
        for (let i = 0; i < colors.length; i += 3) {
          const colorIntensity = Math.random() * fire.intensity
          colors[i] = fire.intensity // Red
          colors[i + 1] = colorIntensity * fire.intensity * 0.8 // Green (for yellow)
          colors[i + 2] = 0 // Blue
        }
        
        geometry.attributes.color.needsUpdate = true
        fire.mesh.scale.set(fire.intensity, fire.intensity, fire.intensity)
      }

      // Spread fire to adjacent cells (slower rate)
      if (fire.spreadTime > FIRE_SPREAD_RATE / gameState.gameSpeed) {
        fire.spreadTime = 0
        const spreadChance = fire.intensity * gameState.windSpeed * 0.2 // Reduced spread chance

        // Try to spread in wind direction and random directions
        const directions = [
          { x: GRID_SIZE, z: 0 },
          { x: -GRID_SIZE, z: 0 },
          { x: 0, z: GRID_SIZE },
          { x: 0, z: -GRID_SIZE }
        ]

        for (const dir of directions) {
          if (Math.random() < spreadChance) {
            const newX = fire.x + dir.x + gameState.windDirection.x * GRID_SIZE
            const newZ = fire.z + dir.z + gameState.windDirection.z * GRID_SIZE
            const newKey = `${Math.floor(newX / GRID_SIZE)}-${Math.floor(newZ / GRID_SIZE)}`

            const halfWorld = WORLD_SIZE / 2
            if (Math.abs(newX) < halfWorld && Math.abs(newZ) < halfWorld && !newFires.has(newKey)) {
              // Create realistic spreading fire with enhanced spherical particles
              const particleCount = 250
              const fireGeometry = new THREE.BufferGeometry()
              const positions = new Float32Array(particleCount * 3)
              const colors = new Float32Array(particleCount * 3)
              const sizes = new Float32Array(particleCount)

              const fireIntensity = 0.3
              
              for (let p = 0; p < particleCount; p++) {
                // Random positions within fire area
                const radius = Math.random() * 1
                const angle = Math.random() * Math.PI * 2
                const height = Math.random() * 2
                
                positions[p * 3] = Math.cos(angle) * radius
                positions[p * 3 + 1] = height
                positions[p * 3 + 2] = Math.sin(angle) * radius
                
                // Fire colors (red to yellow gradient)
                const colorIntensity = Math.random()
                colors[p * 3] = fireIntensity // Red
                colors[p * 3 + 1] = colorIntensity * fireIntensity * 0.8 // Green (for yellow)
                colors[p * 3 + 2] = 0 // Blue
                
                sizes[p] = Math.random() * 2 + 0.5
              }
              
              fireGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
              fireGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
              fireGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1))
              
              const fireMaterial = new THREE.PointsMaterial({
                size: 0.2,
                vertexColors: true,
                transparent: true,
                opacity: 0.7,
                blending: THREE.AdditiveBlending,
                map: (() => {
                  const canvas = document.createElement('canvas')
                  canvas.width = 16
                  canvas.height = 16
                  const context = canvas.getContext('2d')!
                  const gradient = context.createRadialGradient(8, 8, 0, 8, 8, 8)
                  gradient.addColorStop(0, 'rgba(255,255,255,0.8)')
                  gradient.addColorStop(0.3, 'rgba(255,255,0,0.6)')
                  gradient.addColorStop(0.6, 'rgba(255,128,0,0.4)')
                  gradient.addColorStop(1, 'rgba(255,0,0,0)')
                  context.fillStyle = gradient
                  context.fillRect(0, 0, 16, 16)
                  const texture = new THREE.CanvasTexture(canvas)
                  return texture
                })()
              })
              
              const fireMesh = new THREE.Points(fireGeometry, fireMaterial)
              fireMesh.position.set(newX, 0, newZ)
              scene.add(fireMesh)

              newFires.set(newKey, {
                x: Math.floor(newX / GRID_SIZE) * GRID_SIZE,
                z: Math.floor(newZ / GRID_SIZE) * GRID_SIZE,
                intensity: fireIntensity,
                spreadTime: 0,
                mesh: fireMesh
              })
            }
          }
        }
      }
    }

    return newFires
  }

  // Check water collision with fires
  const checkWaterFireCollision = (player: Player, fires: Map<string, FireCell>, deltaTime: number): Map<string, FireCell> => {
    const newFires = new Map(fires)
    const scene = sceneRef.current
    if (!scene) return newFires

    if (keysRef.current.has(' ') && player.waterLevel > 0) {
      for (const [key, fire] of newFires) {
        const firePos = { x: fire.x, y: 0, z: fire.z }
        const distToFire = distance3D(player.position, firePos)
        
        if (distToFire < WATER_RANGE) {
          // Check if fire is in water direction (cone)
          const dirToFire = normalize3D({ 
            x: firePos.x - player.position.x, 
            y: 0, 
            z: firePos.z - player.position.z 
          })
          const waterDirection = { 
            x: Math.sin(player.rotation), 
            y: 0, 
            z: -Math.cos(player.rotation) 
          }
          
          const dotProduct = dirToFire.x * waterDirection.x + dirToFire.z * waterDirection.z
          
          if (dotProduct > 0.4) { // 70-degree cone
            fire.intensity -= 1.5 * deltaTime // Reduce intensity faster
            if (fire.intensity <= 0) {
              if (fire.mesh) {
                // Proper Three.js resource disposal
                if (fire.mesh.geometry) {
                  fire.mesh.geometry.dispose()
                }
                if (fire.mesh.material) {
                  // Handle both single Material and Material[] cases
                  const materials = Array.isArray(fire.mesh.material) ? fire.mesh.material : [fire.mesh.material]
                  materials.forEach(material => {
                    if (material instanceof THREE.PointsMaterial) {
                      if (material.map) {
                        material.map.dispose()
                      }
                    }
                    material.dispose()
                  })
                }
                scene.remove(fire.mesh)
              }
              newFires.delete(key)
            }
          }
        }
      }
    }

    return newFires
  }

  // Check game conditions
  const checkGameConditions = (player: Player, fires: Map<string, FireCell>): 'playing' | 'won' | 'lost' => {
    // Check if player is too close to any fire
    for (const fire of fires.values()) {
      const firePos = { x: fire.x, y: 0, z: fire.z }
      if (distance3D(player.position, firePos) < 1.5) {
        return 'lost'
      }
    }

    // Check if all fires are extinguished
    if (fires.size === 0) {
      return 'won'
    }

    return 'playing'
  }

  // Update camera to follow player (3rd person)
  const updateCamera = (player: Player): void => {
    const camera = cameraRef.current
    if (!camera) return

    // 3rd person camera following player
    const targetX = player.position.x - Math.sin(player.rotation) * CAMERA_DISTANCE
    const targetZ = player.position.z + Math.cos(player.rotation) * CAMERA_DISTANCE
    const targetY = CAMERA_HEIGHT

    camera.position.lerp(new THREE.Vector3(targetX, targetY, targetZ), 0.1)
    camera.lookAt(player.position.x, player.position.y + 2, player.position.z)
  }

  // Regenerate trees and add them to scene
  const regenerateTrees = (): void => {
    const scene = sceneRef.current
    if (!scene) return
    
    // Remove existing trees from scene
    const objectsToRemove: THREE.Object3D[] = []
    scene.traverse((child) => {
      if (child.userData.isTree) {
        objectsToRemove.push(child)
      }
    })
    objectsToRemove.forEach(obj => scene.remove(obj))
    
    // Generate new random trees
    const newTrees = generateTrees(gameState.refillStations)
    
    // Create 3D tree meshes in the scene
    newTrees.forEach(tree => {
      const treeHeight = Math.random() * 3 + 4 // 4-7 units tall
      const fullRadius = tree.radius / 0.8 // Convert back from collision radius
      
      // Tree trunk
      const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.3, 1.5, 8)
      const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 }) // Brown
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial)
      trunk.position.set(tree.x, 0.75, tree.z)
      trunk.castShadow = true
      trunk.receiveShadow = true
      trunk.userData = { isTree: true } // Mark for easy cleanup
      scene.add(trunk)
      
      // Tree foliage (green cone)
      const foliageGeometry = new THREE.ConeGeometry(fullRadius, treeHeight, 8)
      const foliageMaterial = new THREE.MeshLambertMaterial({ color: 0x228B22 }) // Forest green
      const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial)
      foliage.position.set(tree.x, 1.5 + treeHeight / 2, tree.z)
      foliage.castShadow = true
      foliage.receiveShadow = true
      foliage.userData = { isTree: true } // Mark for easy cleanup
      scene.add(foliage)
    })
    
    // Update game state with new tree positions
    setGameState(prev => ({ ...prev, trees: newTrees }))
  }

  // Main game loop
  const gameLoop = useCallback((currentTime: number) => {
    const deltaTime = (currentTime - lastFrameTimeRef.current) / 1000
    lastFrameTimeRef.current = currentTime

    // FPS calculation
    frameCountRef.current++
    if (currentTime - fpsUpdateTimeRef.current >= 1000) {
      setFps(frameCountRef.current)
      frameCountRef.current = 0
      fpsUpdateTimeRef.current = currentTime
    }

    if (gameState.gameStatus === 'playing') {
      setGameState(prevState => {
        const updatedPlayer = updatePlayer(prevState.player, deltaTime)
        let updatedFires = updateFires(prevState.fires, deltaTime)
        updatedFires = checkWaterFireCollision(updatedPlayer, updatedFires, deltaTime)
        const newGameStatus = checkGameConditions(updatedPlayer, updatedFires)

        // Update camera
        updateCamera(updatedPlayer)

        return {
          ...prevState,
          player: updatedPlayer,
          fires: updatedFires,
          gameStatus: newGameStatus,
          timeElapsed: prevState.timeElapsed + deltaTime,
          gameSpeed: Math.min(1.8, 1 + prevState.timeElapsed / 90) // Slower difficulty increase
        }
      })
    }

    // Render
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current)
    }

    gameLoopRef.current = requestAnimationFrame(gameLoop)
  }, [gameState, checkGameConditions, checkWaterFireCollision, updateFires, updatePlayer])

  // Start game
  const startGame = (): void => {
    const newFires = initializeFires()
    setGameState(prevState => ({
      ...prevState,
      gameStatus: 'playing',
      fires: newFires,
      player: {
        ...prevState.player,
        position: { x: 0, y: 0, z: 0 },
        rotation: 0,
        waterLevel: 100,
        isRefilling: false
      },
      timeElapsed: 0,
      gameSpeed: 1
    }))
    setShowTutorial(false)
  }

  // Reset game
  const resetGame = (): void => {
    // Clear existing fires from scene with proper resource disposal
    const scene = sceneRef.current
    if (scene) {
      gameState.fires.forEach(fire => {
        if (fire.mesh) {
          // Proper Three.js resource disposal
          if (fire.mesh.geometry) {
            fire.mesh.geometry.dispose()
          }
          if (fire.mesh.material) {
            // Handle both single Material and Material[] cases
            const materials = Array.isArray(fire.mesh.material) ? fire.mesh.material : [fire.mesh.material]
            materials.forEach(material => {
              if (material instanceof THREE.PointsMaterial) {
                if (material.map) {
                  material.map.dispose()
                }
              }
              material.dispose()
            })
          }
          scene.remove(fire.mesh)
        }
      })
    }
    
    // Regenerate trees with new random positions
    regenerateTrees()
    
    startGame()
  }

  // Mobile touch handlers
  const handleTouchStart = useCallback((e: TouchEvent): void => {
    if (!isMobile || gameState.gameStatus !== 'playing') return
    e.preventDefault()
    
    for (let i = 0; i < e.touches.length; i++) {
      const touch = e.touches[i]
      const x = touch.clientX
      const y = touch.clientY
      
      // Check joystick
      const joystickDist = Math.sqrt(
        (x - mobileControls.joystick.position.x) ** 2 + 
        (y - mobileControls.joystick.position.y) ** 2
      )
      if (joystickDist < mobileControls.joystick.size) {
        setMobileControls(prev => ({
          ...prev,
          joystick: { ...prev.joystick, active: true }
        }))
      }
      
      // Check shoot button
      const shootDist = Math.sqrt(
        (x - mobileControls.shootButton.position.x) ** 2 + 
        (y - mobileControls.shootButton.position.y) ** 2
      )
      if (shootDist < mobileControls.shootButton.size) {
        keysRef.current.add(' ')
        setMobileControls(prev => ({
          ...prev,
          shootButton: { ...prev.shootButton, active: true }
        }))
      }
    }
  }, [isMobile, gameState.gameStatus, mobileControls])

  // Initialize scene when component mounts
  useEffect(() => {
    initScene()
    
    return () => {
      if (rendererRef.current && mountRef.current) {
        useEffect(() => {
          const mount = mountRef.current;
          
          return () => {
            // cleanup using mount
          };
        }, []);  
      }
    }
  }, [initScene])

  // Start game loop
  useEffect(() => {
    gameLoopRef.current = requestAnimationFrame(gameLoop)
    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current)
      }
    }
  }, [gameLoop])

  // Add mobile touch event listeners
  useEffect(() => {
    const renderer = rendererRef.current
    if (!renderer || !isMobile) return

    const canvas = renderer.domElement
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false })
    
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart)
    }
  }, [isMobile, handleTouchStart])

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden">
      {/* Game Container */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Game HUD */}
      {gameState.gameStatus === 'playing' && (
        <>
          {/* Stats Monitor - Top Right */}
          <div className="absolute top-4 right-4 bg-black bg-opacity-60 text-white p-3 rounded-lg text-sm space-y-1">
            <div>FPS: {fps}</div>
            <div>Mobile: {isMobile ? 'true' : 'false'}</div>
            <div>Position: ({Math.round(gameState.player.position.x)}, {Math.round(gameState.player.position.z)})</div>
            <div>Fires Left: {gameState.fires.size}</div>
          </div>

          {/* Control Instructions */}
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black bg-opacity-60 text-white p-3 rounded-lg text-sm text-center">
            <div className="font-semibold mb-1">Controls</div>
            {isMobile ? (
              <div>Touch joystick to move • Tap 💧 to shoot water</div>
            ) : (
              <div>WASD - Move • ← → Arrows - Rotate • SPACE - Shoot Water</div>
            )}
          </div>

          {/* Water Level and Wind Info */}
          <div className="absolute bottom-4 left-4 space-y-2">
            <div className="bg-black bg-opacity-60 p-2 rounded text-white">
              <div className="text-xs text-blue-300 mb-1">Water Level</div>
              <Progress value={gameState.player.waterLevel} className="w-32 h-2" />
            </div>

            <div className="bg-black bg-opacity-60 p-2 rounded text-xs text-white">
              <div className="text-yellow-300 mb-1">Wind</div>
              <div>Speed: {gameState.windSpeed.toFixed(1)} mph</div>
              <div className="flex items-center">
                <span className="mr-1">Direction:</span>
                <div 
                  className="w-4 h-4 bg-yellow-400 rounded flex items-center justify-center"
                  style={{
                    transform: `rotate(${Math.atan2(gameState.windDirection.z, gameState.windDirection.x) * 180 / Math.PI}deg)`
                  }}
                >→</div>
              </div>
            </div>
          </div>

          {/* Mobile Controls Overlay */}
          {isMobile && (
            <>
              {/* Virtual Joystick */}
              <div 
                className="absolute w-16 h-16 border-2 border-white border-opacity-50 rounded-full bg-white bg-opacity-20"
                style={{ 
                  left: mobileControls.joystick.position.x - 32, 
                  top: mobileControls.joystick.position.y - 32 
                }}
              >
                <div className="w-6 h-6 bg-white bg-opacity-60 rounded-full absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2" />
              </div>

              {/* Shoot Button */}
              <div 
                className={`absolute w-12 h-12 rounded-full flex items-center justify-center text-white text-xl ${
                  mobileControls.shootButton.active ? 'bg-red-600 bg-opacity-80' : 'bg-red-500 bg-opacity-60'
                }`}
                style={{ 
                  left: mobileControls.shootButton.position.x - 24, 
                  top: mobileControls.shootButton.position.y - 24 
                }}
              >
                💧
              </div>
            </>
          )}
        </>
      )}

      {/* Tutorial Modal */}
      {showTutorial && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardContent className="p-6 space-y-4">
              <h2 className="text-2xl font-bold text-center text-orange-500">🔥 WildFireFighters</h2>
              
              <div className="space-y-3 text-sm">
                <div className="bg-gray-100 p-3 rounded">
                  <h3 className="font-semibold mb-2">🎯 Your Mission:</h3>
                  <p>Navigate the 3D forest and extinguish all wildfires before they spread uncontrollably!</p>
                </div>

                <div className="bg-blue-50 p-3 rounded">
                  <h3 className="font-semibold mb-2">🎮 3D Controls:</h3>
                  {isMobile ? (
                    <div>
                      <p>• Touch joystick to move in 3D space</p>
                      <p>• Tap 💧 button to shoot water</p>
                      <p>• Find blue cylinder stations to refill</p>
                    </div>
                  ) : (
                    <div>
                      <p>• WASD keys to move forward/back/strafe</p>
                      <p>• ← → Arrow keys to rotate and look around</p>
                      <p>• SPACEBAR to shoot water jets</p>
                      <p>• Approach blue cylinder stations to refill</p>
                    </div>
                  )}
                </div>

                <div className="bg-yellow-50 p-3 rounded">
                  <h3 className="font-semibold mb-2">⚠️ 3D Strategy:</h3>
                  <p>• Fires spread slower but in all directions</p>
                  <p>• Use 3rd-person view to survey the battlefield</p>
                  <p>• Don&apos;t get surrounded by fire cones</p>
                  <p>• Wind affects fire spread patterns</p>
                </div>
              </div>

              <Button onClick={startGame} className="w-full bg-orange-500 hover:bg-orange-600">
                Start 3D Fire Fighting! 🚒
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Game Over Modal */}
      {(gameState.gameStatus === 'won' || gameState.gameStatus === 'lost') && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardContent className="p-6 space-y-4 text-center">
              {gameState.gameStatus === 'won' ? (
                <>
                  <h2 className="text-3xl font-bold text-green-500">🎉 Victory!</h2>
                  <p className="text-lg">You&apos;ve successfully extinguished all 3D wildfires!</p>
                  <div className="bg-green-50 p-4 rounded">
                    <p className="font-semibold">All fires extinguished!</p>
                    <p>Time: {Math.round(gameState.timeElapsed)}s</p>
                    <p className="text-sm text-green-700 mt-2">
                      Outstanding 3D firefighting skills! 🌲
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-3xl font-bold text-red-500">💥 Game Over</h2>
                  <p className="text-lg">You were caught by the spreading wildfire!</p>
                  <div className="bg-red-50 p-4 rounded">
                    <p className="font-semibold">Fires remaining: {gameState.fires.size}</p>
                    <p>Time Survived: {Math.round(gameState.timeElapsed)}s</p>
                    <p className="text-sm text-red-700 mt-2">
                      Keep practicing your 3D firefighting techniques!
                    </p>
                  </div>
                </>
              )}

              <div className="flex gap-3">
                <Button onClick={resetGame} className="flex-1">
                  Try Again 🔄
                </Button>
                <Button onClick={() => {
                  setShowTutorial(true)
                  // Reset game status to hide Game Over modal
                  setGameState(prev => ({ ...prev, gameStatus: 'tutorial' }))
                }} variant="outline" className="flex-1">
                  Instructions 📖
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}