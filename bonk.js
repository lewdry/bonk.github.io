// Constants
const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
const splashScreen = document.getElementById('splashScreen');

// Game Constants
const DRAG_COEFFICIENT = 0.999;
const NUM_BALLS = 15;
const COLLISION_COOLDOWN_FRAMES = 5;
const SEPARATION_ITERATIONS = 10;
const MAX_ACTIVE_SOUNDS = 20;
const VELOCITY_THRESHOLD = 0.1;
const BOUNDARY_MARGIN = 1;
const HIDDEN_THRESHOLD = 5000; // 5 seconds
const FIXED_TIME_STEP = 1000 / 60;
const GRABBED_BALL_SCALE = 1.1;

// Set canvas size to match window and calculate scale factor
function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);
}

// Initial canvas size
resizeCanvas();

document.addEventListener('DOMContentLoaded', async (event) => {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        const soundFiles = ['G2.mp3', 'B2.mp3', 'D3.mp3', 'G3.mp3', 'B3.mp3', 'D4.mp3', 'G4.mp3'];

        const loadAudioFile = async (file) => {
            try {
                const response = await fetch(`sounds/${file}`);
                if (!response.ok) {
                    throw new Error(`Failed to fetch ${file}: ${response.statusText}`);
                }
                const arrayBuffer = await response.arrayBuffer();
                const audioData = await audioContext.decodeAudioData(arrayBuffer);
                collisionBuffers[file] = audioData;
                console.log(`Audio file ${file} loaded successfully`);
            } catch (error) {
                console.error(`Error loading audio file ${file}:`, error);
            }
        };

        await Promise.all(soundFiles.map(loadAudioFile));

        // Initialize game after sounds are loaded
        if (!splashScreenDismissed) {
            initGame();
        }

        // Add visibility change listener
        document.addEventListener('visibilitychange', handleVisibilityChange);

    } catch (error) {
        console.error('Error initializing audio context:', error);
    }
});

class Ball {
    constructor() {
        this.reset();
    }

    reset() {
        this.radius = Math.random() * 18 + 12;
        this.mass = Math.PI * this.radius ** 2;
        this.x = Math.random() * (canvas.width / window.devicePixelRatio - 2 * this.radius) + this.radius;
        this.y = Math.random() * (canvas.height / window.devicePixelRatio - 2 * this.radius) + this.radius;
        this.dx = (Math.random() - 0.5) * 5;
        this.dy = (Math.random() - 0.5) * 5;
        this.colour = `rgb(${Math.random() * 255},${Math.random() * 255},${Math.random() * 255})`;
        this.grabbed = false;
        this.collisionCooldown = 0;
        this.lastCollidedWith = null;
    }

    move() {
        if (!this.grabbed) {
            // Apply drag to slow down the ball
            this.dx *= DRAG_COEFFICIENT;
            this.dy *= DRAG_COEFFICIENT;

            if (Math.abs(this.dx) < VELOCITY_THRESHOLD && Math.abs(this.dy) < VELOCITY_THRESHOLD) {
                this.dx = 0;
                this.dy = 0;
            }
    
            this.x += this.dx;
            this.y += this.dy;
            this.resolveBoundaryCollision();
        }

        // Decrement collision cooldown
        if (this.collisionCooldown > 0) {
            this.collisionCooldown--;
        }
    }

    resolveBoundaryCollision() {
        const canvasWidth = canvas.width / window.devicePixelRatio;
        const canvasHeight = canvas.height / window.devicePixelRatio;
        if (this.x - this.radius <= BOUNDARY_MARGIN) {
            this.x = this.radius + BOUNDARY_MARGIN;
            this.dx = Math.abs(this.dx);
        } else if (this.x + this.radius >= canvasWidth - BOUNDARY_MARGIN) {
            this.x = canvasWidth - this.radius - BOUNDARY_MARGIN;
            this.dx = -Math.abs(this.dx);
        }
        if (this.y - this.radius <= BOUNDARY_MARGIN) {
            this.y = this.radius + BOUNDARY_MARGIN;
            this.dy = Math.abs(this.dy);
        } else if (this.y + this.radius >= canvasHeight - BOUNDARY_MARGIN) {
            this.y = canvasHeight - this.radius - BOUNDARY_MARGIN;
            this.dy = -Math.abs(this.dy);
        }
    }

    draw() {
        const drawRadius = this.grabbed ? this.radius * GRABBED_BALL_SCALE : this.radius;

        // Draw the main colored part of the ball
        ctx.beginPath();
        ctx.arc(this.x, this.y, drawRadius, 0, Math.PI * 2);
        ctx.fillStyle = this.colour;
        ctx.fill();
        ctx.closePath();

        // Add subtle glow effect when grabbed
        if (this.grabbed) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, drawRadius + 2, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.closePath();
        }
    }

    checkCollision(other) {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return distance < this.radius + other.radius;
    }

    getSpeed() {
        return Math.sqrt(this.dx * this.dx + this.dy * this.dy);
    }

    resolveCollision(other) {
        const dx = other.x - this.x;
        const dy = other.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const overlap = this.radius + other.radius - distance;
        
        if (overlap > 0) {
            const angle = Math.atan2(dy, dx);
            const separationDistance = 1; // 1px separation
            const totalSeparation = overlap + separationDistance;
            const moveX = totalSeparation * Math.cos(angle) / 2;
            const moveY = totalSeparation * Math.sin(angle) / 2;
            
            if (!this.grabbed && !other.grabbed) {
                // Separate the balls
                this.x -= moveX;
                this.y -= moveY;
                other.x += moveX;
                other.y += moveY;
    
                // Collision counting logic
                if (this.lastCollidedWith !== other && this.collisionCooldown <= 0 && other.collisionCooldown <= 0) {
                    collisionCount++;
                    this.lastCollidedWith = other;
                    other.lastCollidedWith = this;
                    this.collisionCooldown = COLLISION_COOLDOWN_FRAMES;
                    other.collisionCooldown = COLLISION_COOLDOWN_FRAMES;
                }
    
                // Velocity resolution - FIXED: Store tangent velocities before modifying dx/dy
                const normalX = dx / distance;
                const normalY = dy / distance;
                const tangentX = -normalY;
                const tangentY = normalX;
    
                const dotProductThis = this.dx * normalX + this.dy * normalY;
                const dotProductOther = other.dx * normalX + other.dy * normalY;

                // Calculate tangent velocities BEFORE modifying anything
                const thisVt = this.dx * tangentX + this.dy * tangentY;
                const otherVt = other.dx * tangentX + other.dy * tangentY;
    
                const v1n = (dotProductThis * (this.mass - other.mass) + 2 * other.mass * dotProductOther) / (this.mass + other.mass);
                const v2n = (dotProductOther * (other.mass - this.mass) + 2 * this.mass * dotProductThis) / (this.mass + other.mass);
    
                this.dx = v1n * normalX + thisVt * tangentX;
                this.dy = v1n * normalY + thisVt * tangentY;
                other.dx = v2n * normalX + otherVt * tangentX;
                other.dy = v2n * normalY + otherVt * tangentY;
    
                const minSpeed = 0;
                const maxSpeed = 30;
                const minVolume = 0.2; // 20% minimum volume
                const thisSpeed = this.getSpeed();
                const otherSpeed = other.getSpeed();
                const collisionSpeed = Math.max(thisSpeed, otherSpeed);
    
                if (collisionSpeed > minSpeed && Object.keys(collisionBuffers).length > 0) {
                    try {
                        const soundFiles = Object.keys(collisionBuffers);
                        const randomIndex = Math.floor(Math.random() * soundFiles.length);
                        const randomSoundFile = soundFiles[randomIndex];
    
                        // Create a new buffer source and connect it to the destination
                        const source = audioContext.createBufferSource();
                        source.buffer = collisionBuffers[randomSoundFile];
    
                        // Create a gain node to control the volume
                        const gainNode = audioContext.createGain();
                        
                        // Calculate the volume based on collision speed with a minimum volume
                        const normalizedSpeed = (collisionSpeed - minSpeed) / (maxSpeed - minSpeed);
                        const volume = minVolume + (1 - minVolume) * normalizedSpeed;
                        const clampedVolume = Math.min(Math.max(volume, minVolume), 1);
                        
                        gainNode.gain.setValueAtTime(clampedVolume, audioContext.currentTime);
    
                        // Connect the source to the gain node, then to the destination
                        source.connect(gainNode);
                        gainNode.connect(audioContext.destination);
    
                        // Start the sound immediately
                        source.start();
    
                        // Add the new source to the activeSources array
                        activeSources.push({ source, gainNode });
    
                        // Cull older sources and properly disconnect them
                        if (activeSources.length > MAX_ACTIVE_SOUNDS) {
                            const oldest = activeSources.shift();
                            oldest.source.stop();
                            oldest.source.disconnect();
                            oldest.gainNode.disconnect();
                        }
    
                        console.log(`Collision speed: ${collisionSpeed.toFixed(2)}, Volume: ${clampedVolume.toFixed(2)}`);
                    } catch (error) {
                        console.error("Error playing sound:", error);
                    }
                }
            } else if (this.grabbed) {
                other.x = this.x + (other.radius + this.radius + separationDistance) * Math.cos(angle);
                other.y = this.y + (other.radius + this.radius + separationDistance) * Math.sin(angle);
            } else if (other.grabbed) {
                this.x = other.x - (other.radius + this.radius + separationDistance) * Math.cos(angle);
                this.y = other.y - (other.radius + this.radius + separationDistance) * Math.sin(angle);
            }
    
            return true;
        } else {
            // Reset lastCollidedWith if balls are not touching
            if (this.lastCollidedWith === other) {
                this.lastCollidedWith = null;
                other.lastCollidedWith = null;
            }
        }
        return false;
    }

    checkGrabbed(pos) {
        const distance = Math.hypot(this.x - pos.x, this.y - pos.y);
        return distance < this.radius;
    }
}

// Game variables
let balls = [];
let collisionCount = 0;
let grabbedBall = null;
let interactionStartPos = null;
let lastCursorTime = 0;
let gameRunning = false;
let stoppedFor = 0;
let allBallsStopped = false;
let lastStopTime = 0;
let activeSources = []; // Array to keep track of active audio sources
let splashScreenDismissed = false;
let audioContext;
let collisionBuffers = {};
let lastHiddenTime = 0;
let lastTime = 0;
let lastGrabbedPos = null;

function initGame() {
    if (!canvas) {
        console.error('Canvas element not found');
        return;
    }

    resetGame();

    document.addEventListener('pointerdown', handleStart, { passive: false });
    canvas.addEventListener('pointermove', handleMove, { passive: false });
    canvas.addEventListener('pointerup', handleEnd, { passive: false });
    canvas.addEventListener('pointercancel', handleEnd, { passive: false });
    canvas.addEventListener('dblclick', handleDoubleTap, false);

    // Prevent default touch behaviors on canvas
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false });
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false });
    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
    }, { passive: false });

    document.getElementById('startButton').addEventListener('click', dismissSplashScreen, false);

    showSplashScreen();
    requestAnimationFrame(gameLoop);
}

function dismissSplashScreen() {
    if (splashScreen.style.display !== 'none') {
        splashScreen.style.display = 'none';
        gameRunning = true;
        splashScreenDismissed = true;
        reinitializeGameState();
    }
}

function resumeAudioContext() {
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log('AudioContext resumed successfully');
        }).catch(error => {
            console.error('Failed to resume AudioContext:', error);
        });
    }
}

// Handle window resizing
function handleResize() {
    const oldWidth = canvas.width;
    const oldHeight = canvas.height;
    
    resizeCanvas();
    
    const widthRatio = canvas.width / oldWidth;
    const heightRatio = canvas.height / oldHeight;
    
    balls.forEach(ball => {
        ball.x *= widthRatio;
        ball.y *= heightRatio;
        ball.dx *= widthRatio;
        ball.dy *= heightRatio;
    });
}

window.addEventListener('resize', () => {
    handleResize();
    separateOverlappingBalls();
});

function handleVisibilityChange() {
    if (document.hidden) {
        lastHiddenTime = Date.now();
    } else {
        if (Date.now() - lastHiddenTime > HIDDEN_THRESHOLD) {
            showSplashScreen();
            reinitializeGameState();
        } else {
            resumeAudioContext();
            if (!gameRunning) {
                gameRunning = true;
                requestAnimationFrame(gameLoop);
            }
        }
    }
}

function reinitializeGameState() {
    resumeAudioContext();
    if (!gameRunning) {
        gameRunning = true;
        requestAnimationFrame(gameLoop);
    }
}

function resetGame() {
    balls = Array.from({ length: NUM_BALLS }, () => new Ball());
    separateOverlappingBalls();
    collisionCount = 0;
    stoppedFor = 0;
    allBallsStopped = false;
}

function separateOverlappingBalls() {
    for (let i = 0; i < SEPARATION_ITERATIONS; i++) {
        let overlapsFound = false;
        for (let j = 0; j < balls.length; j++) {
            for (let k = j + 1; k < balls.length; k++) {
                if (balls[j].resolveCollision(balls[k])) {
                    overlapsFound = true;
                }
            }
        }
        if (!overlapsFound) break;
    }
}

function showSplashScreen() {
    splashScreen.style.display = 'flex';
    gameRunning = false;
    splashScreenDismissed = false;
}

function gameLoop(currentTime) {
    if (!gameRunning) {
        requestAnimationFrame(gameLoop);
        return;
    }

    if (currentTime - lastTime >= FIXED_TIME_STEP) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        let allStopped = true;
        balls.forEach((ball, i) => {
            ball.move();
            for (let j = i + 1; j < balls.length; j++) {
                if (ball.checkCollision(balls[j])) {
                    ball.resolveCollision(balls[j]);
                }
            }
            ball.draw();
            if (ball.dx !== 0 || ball.dy !== 0) {
                allStopped = false;
            }
        });

        if (allStopped) {
            if (!allBallsStopped) {
                allBallsStopped = true;
                lastStopTime = currentTime;
            } else {
                stoppedFor = Math.floor((currentTime - lastStopTime) / 1000);
            }
        } else {
            allBallsStopped = false;
            stoppedFor = 0; // Reset the counter when balls start moving
        }

        ctx.fillStyle = 'black';
        ctx.font = '16px sans-serif';
        
        const counterText = `${collisionCount} Bonks`;
        const textWidth = ctx.measureText(counterText).width;
        ctx.fillText(counterText, canvas.width / window.devicePixelRatio - textWidth - 6, 16);
        
        if (allBallsStopped && stoppedFor > 0) {
            const stoppedText = `Wow! Stopped for ${stoppedFor}s`;
            ctx.fillText(stoppedText, 6, 16);
        }

        lastTime = currentTime;
    }

    requestAnimationFrame(gameLoop);
}

function getEventPos(event) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (event.clientX - rect.left) * scaleX / window.devicePixelRatio,
        y: (event.clientY - rect.top) * scaleY / window.devicePixelRatio
    };
}

function handleStart(event) {
    event.preventDefault();
    event.stopPropagation();
    const currentTime = Date.now();
    const pos = getEventPos(event);
    interactionStartPos = pos;
    lastCursorTime = currentTime;
    lastGrabbedPos = pos;

    for (const ball of balls) {
        if (ball.checkGrabbed(pos)) {
            grabbedBall = ball;
            ball.grabbed = true;
            ball.dx = 0;
            ball.dy = 0;
            break;
        }
    }
}

function handleMove(event) {
    event.preventDefault();
    event.stopPropagation();
    const pos = getEventPos(event);

    if (grabbedBall) {
        const dx = pos.x - lastGrabbedPos.x;
        const dy = pos.y - lastGrabbedPos.y;
        const speed = Math.sqrt(dx * dx + dy * dy);
        const maxSpeed = 30;
        const normalizedSpeed = Math.min(speed, maxSpeed) / maxSpeed;

        grabbedBall.x = pos.x;
        grabbedBall.y = pos.y;

        balls.forEach(ball => {
            if (ball !== grabbedBall && grabbedBall.checkCollision(ball)) {
                const angle = Math.atan2(ball.y - grabbedBall.y, ball.x - grabbedBall.x);
                const pushForce = 10 * normalizedSpeed;
                ball.dx += Math.cos(angle) * pushForce;
                ball.dy += Math.sin(angle) * pushForce;
            }
        });

        lastGrabbedPos = pos;
    }
}

function handleEnd(event) {
    event.preventDefault();
    event.stopPropagation();
    if (grabbedBall) {
        const pos = getEventPos(event);
        const timeDelta = (Date.now() - lastCursorTime) / 1000;
        const maxVelocity = 16;
        grabbedBall.dx = Math.max(-maxVelocity, Math.min(maxVelocity, (pos.x - interactionStartPos.x) / (timeDelta * 10)));
        grabbedBall.dy = Math.max(-maxVelocity, Math.min(maxVelocity, (pos.y - interactionStartPos.y) / (timeDelta * 10)));
        grabbedBall.grabbed = false;
        grabbedBall = null;
    }
}

function handleDoubleTap(event) {
    event.preventDefault();
    event.stopPropagation();
    resetGame();
}