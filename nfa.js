document.addEventListener('DOMContentLoaded', () => {
    // --- Initial Setup ---
    const canvas = document.getElementById('automata-canvas');
    const svgNS = 'http://www.w3.org/2000/svg';

    // Create layers to ensure states are drawn strictly over edges
    const elementsGroup = document.createElementNS(svgNS, 'g');
    elementsGroup.setAttribute('id', 'pan-group');
    const edgesGroup = document.createElementNS(svgNS, 'g');
    const nodesGroup = document.createElementNS(svgNS, 'g');

    elementsGroup.appendChild(edgesGroup);
    elementsGroup.appendChild(nodesGroup);
    canvas.appendChild(elementsGroup);

    // --- Pan / Zoom State ---
    let panX = 0, panY = 0;
    let zoom = 1;
    const ZOOM_MIN = 0.2, ZOOM_MAX = 5;
    let isPanning = false;
    let panStartX = 0, panStartY = 0;

    // --- UI State & Tools ---
    const tools = {
        select: document.getElementById('tool-select'),
        state: document.getElementById('tool-state'),
        transition: document.getElementById('tool-transition'),
    };

    const contextMenus = {
        state: document.getElementById('state-context-menu'),
        transition: document.getElementById('transition-context-menu')
    };

    let currentMode = 'select';
    const STATE_RADIUS = 25;

    // Application Data structure
    const appState = {
        nodes: [], // { id, label, x, y, isStart, isAccept }
        edges: [], // { id, from, to, symbols: [], cpX?, cpY? }
        selectedNodeId: null,
        selectedEdgeId: null,
        nodeCounter: 0,
        edgeCounter: 0,

        // Interaction states
        dragNodeId: null,
        dragOffsetX: 0,
        dragOffsetY: 0,

        isDrawingEdge: false,
        tempEdgeSourceId: null,
        drawingPoints: [],
        mouseX: 0,
        mouseY: 0,
    };

    // --- UI Initialization ---
    Object.keys(tools).forEach(key => {
        tools[key].addEventListener('click', () => {
            Object.values(tools).forEach(btn => btn.classList.remove('active'));
            tools[key].classList.add('active');
            currentMode = key;

            const msgs = {
                select: 'Select an element to view properties, drag to move nodes.',
                state: 'Click on the canvas to add a new state.',
                transition: 'Click and drag from a state to draw a transition.'
            };
            document.getElementById('status-message').textContent = msgs[currentMode];

            if (currentMode !== 'select') {
                deselectAll();
            }
        });
    });

    document.getElementById('prop-name').addEventListener('input', (e) => {
        if (appState.selectedNodeId) {
            const node = appState.nodes.find(n => n.id === appState.selectedNodeId);
            if (node) {
                node.label = e.target.value || node.id;
                updateRender();
            }
        }
    });

    // NFA: Multiple start states allowed — do NOT clear others when checking
    document.getElementById('prop-start').addEventListener('change', (e) => {
        if (appState.selectedNodeId) {
            const node = appState.nodes.find(n => n.id === appState.selectedNodeId);
            if (node) {
                node.isStart = e.target.checked;
                updateRender();
            }
        }
    });

    document.getElementById('prop-accept').addEventListener('change', (e) => {
        if (appState.selectedNodeId) {
            const node = appState.nodes.find(n => n.id === appState.selectedNodeId);
            if (node) {
                node.isAccept = e.target.checked;
                updateRender();
            }
        }
    });

    document.getElementById('btn-delete-state').addEventListener('click', () => {
        if (appState.selectedNodeId) {
            appState.nodes = appState.nodes.filter(n => n.id !== appState.selectedNodeId);
            appState.edges = appState.edges.filter(e => e.from !== appState.selectedNodeId && e.to !== appState.selectedNodeId);
            deselectAll();
        }
    });

    document.getElementById('transition-symbol-input').addEventListener('input', (e) => {
        if (appState.selectedEdgeId) {
            const edge = appState.edges.find(edge => edge.id === appState.selectedEdgeId);
            if (edge) {
                const symbols = e.target.value.split(',').map(s => s.trim()).filter(s => s.length > 0);
                edge.symbols = symbols.length > 0 ? symbols : ['ε'];
                updateRender();
            }
        }
    });

    document.getElementById('btn-delete-transition').addEventListener('click', () => {
        if (appState.selectedEdgeId) {
            appState.edges = appState.edges.filter(e => e.id !== appState.selectedEdgeId);
            deselectAll();
        }
    });

    // --- Interaction Logic ---
    function deselectAll() {
        appState.selectedNodeId = null;
        appState.selectedEdgeId = null;
        contextMenus.state.style.display = 'none';
        contextMenus.transition.style.display = 'none';
        updateRender();
    }

    function selectNode(id) {
        deselectAll();
        appState.selectedNodeId = id;
        const node = appState.nodes.find(n => n.id === id);
        if (node) {
            contextMenus.state.style.display = 'flex';
            document.getElementById('prop-name').value = node.label;
            document.getElementById('prop-start').checked = node.isStart;
            document.getElementById('prop-accept').checked = node.isAccept;
        }
        updateRender();
    }

    function selectEdge(id) {
        deselectAll();
        appState.selectedEdgeId = id;
        const edge = appState.edges.find(e => e.id === id);
        if (edge) {
            contextMenus.transition.style.display = 'flex';
            document.getElementById('transition-symbol-input').value = edge.symbols.join(', ');
        }
        updateRender();
    }

    // Canvas Events — account for pan and zoom so node positions are in world space
    const getMouseCoords = (e) => {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - panX) / zoom,
            y: (e.clientY - rect.top - panY) / zoom
        };
    };

    const getScreenCoords = (e) => {
        return { sx: e.clientX, sy: e.clientY };
    };

    canvas.addEventListener('mousedown', (e) => {
        const { x, y } = getMouseCoords(e);
        const { sx, sy } = getScreenCoords(e);
        const target = e.target;

        if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
            isPanning = true;
            panStartX = sx - panX;
            panStartY = sy - panY;
            canvas.style.cursor = 'grabbing';
            e.preventDefault();
            return;
        }

        const nodeGroup = target.closest('.state');
        const edgeGroup = target.closest('.transition');

        if (currentMode === 'select' || currentMode === 'transition') {
            if (nodeGroup) {
                const nodeId = nodeGroup.getAttribute('data-id');
                if (currentMode === 'select') {
                    selectNode(nodeId);
                    appState.dragNodeId = nodeId;
                    const node = appState.nodes.find(n => n.id === nodeId);
                    appState.dragOffsetX = x - node.x;
                    appState.dragOffsetY = y - node.y;
                } else if (currentMode === 'transition') {
                    appState.isDrawingEdge = true;
                    appState.tempEdgeSourceId = nodeId;
                    appState.drawingPoints = [{ x, y }];
                    appState.mouseX = x;
                    appState.mouseY = y;
                    updateRender();
                }
                return;
            } else if (edgeGroup && currentMode === 'select') {
                const edgeId = edgeGroup.getAttribute('data-id');
                selectEdge(edgeId);
                return;
            } else if (currentMode === 'select' && !nodeGroup && !edgeGroup) {
                deselectAll();
                isPanning = true;
                panStartX = sx - panX;
                panStartY = sy - panY;
                canvas.style.cursor = 'grabbing';
                return;
            } else {
                deselectAll();
            }
        }

        if (currentMode === 'state' && !nodeGroup) {
            appState.nodes.push({
                id: `q${appState.nodeCounter}`,
                label: `q${appState.nodeCounter}`,
                x, y,
                isStart: appState.nodes.length === 0,
                isAccept: false
            });
            appState.nodeCounter++;
            updateRender();
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        const { sx, sy } = getScreenCoords(e);

        if (isPanning) {
            panX = sx - panStartX;
            panY = sy - panStartY;
            applyPanTransform();
            return;
        }

        const { x, y } = getMouseCoords(e);
        appState.mouseX = x;
        appState.mouseY = y;

        if (appState.dragNodeId && currentMode === 'select') {
            const node = appState.nodes.find(n => n.id === appState.dragNodeId);
            if (node) {
                node.x = x - appState.dragOffsetX;
                node.y = y - appState.dragOffsetY;
                updateRender();
            }
        } else if (appState.isDrawingEdge) {
            appState.drawingPoints.push({ x, y });
            updateRender();
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (isPanning) {
            isPanning = false;
            canvas.style.cursor = 'default';
            return;
        }

        if (appState.dragNodeId) {
            appState.dragNodeId = null;
        }

        if (appState.isDrawingEdge) {
            const target = e.target;
            const nodeGroup = target.closest('.state');

            if (nodeGroup) {
                const targetNodeId = nodeGroup.getAttribute('data-id');
                let existingEdge = appState.edges.find(e => e.from === appState.tempEdgeSourceId && e.to === targetNodeId);
                if (existingEdge) {
                    const cp = computeControlPoint(appState.tempEdgeSourceId, targetNodeId, appState.drawingPoints);
                    if (cp) { existingEdge.cpX = cp.x; existingEdge.cpY = cp.y; }
                    selectEdge(existingEdge.id);
                } else {
                    const cp = computeControlPoint(appState.tempEdgeSourceId, targetNodeId, appState.drawingPoints);
                    const newEdge = {
                        id: `e${appState.edgeCounter++}`,
                        from: appState.tempEdgeSourceId,
                        to: targetNodeId,
                        symbols: ['ε'],
                        cpX: cp ? cp.x : null,
                        cpY: cp ? cp.y : null
                    };
                    appState.edges.push(newEdge);
                    selectEdge(newEdge.id);
                    tools.select.click();
                }
            }

            appState.isDrawingEdge = false;
            appState.tempEdgeSourceId = null;
            appState.drawingPoints = [];
            updateRender();
        }
    });

    canvas.addEventListener('mouseleave', () => {
        appState.dragNodeId = null;
        if (isPanning) {
            isPanning = false;
            canvas.style.cursor = 'default';
        }
        if (appState.isDrawingEdge) {
            appState.isDrawingEdge = false;
            appState.tempEdgeSourceId = null;
            appState.drawingPoints = [];
            updateRender();
        }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    function applyPanTransform() {
        elementsGroup.setAttribute('transform', `translate(${panX}, ${panY}) scale(${zoom})`);
    }

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const oldZoom = zoom;
        const zoomFactor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * zoomFactor));

        panX = mx - (mx - panX) * (zoom / oldZoom);
        panY = my - (my - panY) * (zoom / oldZoom);

        applyPanTransform();
    }, { passive: false });

    function computeControlPoint(srcId, tgtId, points) {
        const src = appState.nodes.find(n => n.id === srcId);
        const tgt = appState.nodes.find(n => n.id === tgtId);
        if (!src || !tgt || points.length < 3) return null;

        const lx = tgt.x - src.x;
        const ly = tgt.y - src.y;
        const len = Math.hypot(lx, ly);
        if (len === 0) return null;

        const nx = -ly / len;
        const ny = lx / len;

        let maxAbsDist = 0;
        let bestPoint = null;
        for (const p of points) {
            const px = p.x - src.x;
            const py = p.y - src.y;
            const signedDist = px * nx + py * ny;
            if (Math.abs(signedDist) > maxAbsDist) {
                maxAbsDist = Math.abs(signedDist);
                bestPoint = p;
            }
        }

        if (maxAbsDist < 15) return null;

        const midX = (src.x + tgt.x) / 2;
        const midY = (src.y + tgt.y) / 2;
        const devX = bestPoint.x - midX;
        const devY = bestPoint.y - midY;

        return {
            x: midX + devX * 2,
            y: midY + devY * 2
        };
    }

    // --- Rendering Math & Logic ---
    function updateRender() {
        nodesGroup.innerHTML = '';
        edgesGroup.innerHTML = '';

        const pairKey = (a, b) => [a, b].sort().join('|');
        const pairSet = new Set();
        const biDirPairs = new Set();
        appState.edges.forEach(e => {
            const k = pairKey(e.from, e.to);
            if (pairSet.has(k) || (e.from !== e.to && appState.edges.some(o => o.from === e.to && o.to === e.from))) {
                biDirPairs.add(k);
            }
            pairSet.add(k);
        });

        // Render Edges
        appState.edges.forEach(edge => {
            const sourceInfo = appState.nodes.find(n => n.id === edge.from);
            const targetInfo = appState.nodes.find(n => n.id === edge.to);
            if (!sourceInfo || !targetInfo) return;

            const isSelected = edge.id === appState.selectedEdgeId;
            const isSelfLoop = edge.from === edge.to;
            const g = document.createElementNS(svgNS, 'g');
            g.classList.add('transition');
            if (isSelected) g.classList.add('selected');
            // Highlight epsilon transitions with a subtle class
            if (edge.symbols.includes('ε') && edge.symbols.length === 1) {
                g.classList.add('epsilon-transition');
            }
            g.setAttribute('data-id', edge.id);

            const path = document.createElementNS(svgNS, 'path');
            path.classList.add('transition-path');

            let textX, textY;

            if (isSelfLoop) {
                const x = sourceInfo.x;
                const y = sourceInfo.y;
                const r = STATE_RADIUS;
                const loopRadius = 30;
                const x1 = x - r * 0.5;
                const y1 = y - r * 0.866;
                const x2 = x + r * 0.5;
                const y2 = y - r * 0.866;

                path.setAttribute('d', `M ${x1} ${y1} C ${x - loopRadius * 1.5} ${y - loopRadius * 3}, ${x + loopRadius * 1.5} ${y - loopRadius * 3}, ${x2} ${y2}`);
                textX = x;
                textY = y - loopRadius * 3.3;
            } else {
                const dx = targetInfo.x - sourceInfo.x;
                const dy = targetInfo.y - sourceInfo.y;
                const distance = Math.hypot(dx, dy);

                if (distance > 0) {
                    const angle = Math.atan2(dy, dx);
                    const hasCustomCP = (edge.cpX != null && edge.cpY != null);

                    if (hasCustomCP) {
                        const aCPsrc = Math.atan2(edge.cpY - sourceInfo.y, edge.cpX - sourceInfo.x);
                        const aCPtgt = Math.atan2(edge.cpY - targetInfo.y, edge.cpX - targetInfo.x);
                        const startX = sourceInfo.x + Math.cos(aCPsrc) * STATE_RADIUS;
                        const startY = sourceInfo.y + Math.sin(aCPsrc) * STATE_RADIUS;
                        const endX = targetInfo.x + Math.cos(aCPtgt) * STATE_RADIUS;
                        const endY = targetInfo.y + Math.sin(aCPtgt) * STATE_RADIUS;

                        path.setAttribute('d', `M ${startX} ${startY} Q ${edge.cpX} ${edge.cpY} ${endX} ${endY}`);
                        const labelX = (startX + 2 * edge.cpX + endX) / 4;
                        const labelY = (startY + 2 * edge.cpY + endY) / 4 - 10;
                        textX = labelX;
                        textY = labelY;
                    } else {
                        const isBiDir = biDirPairs.has(pairKey(edge.from, edge.to));
                        if (isBiDir) {
                            const curveSign = (edge.from < edge.to) ? 1 : -1;
                            const CURVE_OFFSET = 50;
                            const nx = -dy / distance;
                            const ny = dx / distance;
                            const midX = (sourceInfo.x + targetInfo.x) / 2;
                            const midY = (sourceInfo.y + targetInfo.y) / 2;
                            const cpX = midX + nx * CURVE_OFFSET * curveSign;
                            const cpY = midY + ny * CURVE_OFFSET * curveSign;
                            const angOff = 0.45 * curveSign;
                            const startX = sourceInfo.x + Math.cos(angle + angOff) * STATE_RADIUS;
                            const startY = sourceInfo.y + Math.sin(angle + angOff) * STATE_RADIUS;
                            const endX = targetInfo.x - Math.cos(angle - angOff) * STATE_RADIUS;
                            const endY = targetInfo.y - Math.sin(angle - angOff) * STATE_RADIUS;
                            path.setAttribute('d', `M ${startX} ${startY} Q ${cpX} ${cpY} ${endX} ${endY}`);
                            textX = cpX + nx * 14 * curveSign;
                            textY = cpY + ny * 14 * curveSign;
                        } else {
                            const startX = sourceInfo.x + Math.cos(angle) * STATE_RADIUS;
                            const startY = sourceInfo.y + Math.sin(angle) * STATE_RADIUS;
                            const endX = targetInfo.x - Math.cos(angle) * STATE_RADIUS;
                            const endY = targetInfo.y - Math.sin(angle) * STATE_RADIUS;
                            path.setAttribute('d', `M ${startX} ${startY} L ${endX} ${endY}`);
                            textX = (sourceInfo.x + targetInfo.x) / 2;
                            textY = (sourceInfo.y + targetInfo.y) / 2 - 12;
                        }
                    }
                } else {
                    textX = sourceInfo.x; textY = sourceInfo.y;
                }
            }

            const clickPath = path.cloneNode();
            clickPath.setAttribute('stroke', 'transparent');
            clickPath.setAttribute('stroke-width', '15');
            clickPath.setAttribute('fill', 'none');

            const text = document.createElementNS(svgNS, 'text');
            text.classList.add('transition-text');
            text.setAttribute('x', textX);
            text.setAttribute('y', textY);
            text.textContent = edge.symbols.join(', ');

            g.appendChild(path);
            g.appendChild(clickPath);
            g.appendChild(text);

            edgesGroup.appendChild(g);
        });

        // Render Temp Edge — show freehand polyline as the user draws
        if (appState.isDrawingEdge && appState.tempEdgeSourceId && appState.drawingPoints.length > 0) {
            const pts = appState.drawingPoints;
            let pointsStr = pts.map(p => `${p.x},${p.y}`).join(' ');
            pointsStr += ` ${appState.mouseX},${appState.mouseY}`;

            const polyline = document.createElementNS(svgNS, 'polyline');
            polyline.classList.add('temp-transition');
            polyline.setAttribute('points', pointsStr);
            edgesGroup.appendChild(polyline);
        }

        // Render Nodes
        appState.nodes.forEach(node => {
            const g = document.createElementNS(svgNS, 'g');
            g.classList.add('state');
            if (node.id === appState.selectedNodeId) g.classList.add('selected');
            g.setAttribute('data-id', node.id);
            g.setAttribute('transform', `translate(${node.x}, ${node.y})`);

            // Start State Arrow
            if (node.isStart) {
                const arrow = document.createElementNS(svgNS, 'path');
                arrow.classList.add('state-start-arrow');
                arrow.setAttribute('d', `M -60 0 L ${-STATE_RADIUS - 5} 0`);
                g.appendChild(arrow);
            }

            // Main Circle
            const circle = document.createElementNS(svgNS, 'circle');
            circle.classList.add('state-circle');
            circle.setAttribute('r', STATE_RADIUS);
            g.appendChild(circle);

            // Accept State Inner Circle
            if (node.isAccept) {
                const acceptCircle = document.createElementNS(svgNS, 'circle');
                acceptCircle.classList.add('state-accept-circle');
                acceptCircle.setAttribute('r', STATE_RADIUS - 5);
                g.appendChild(acceptCircle);
            }

            // Label
            const text = document.createElementNS(svgNS, 'text');
            text.classList.add('state-text');
            text.textContent = node.label;
            g.appendChild(text);

            nodesGroup.appendChild(g);
        });

    }

    // --- NFA Simulation Engine ---
    appState.sim = {
        activeStates: [],
        tape: [],
        head: 0,
        status: 'idle',
        intervalId: null
    };

    const uiControls = {
        input: document.getElementById('sim-input'),
        btnReset: document.getElementById('btn-reset'),
        btnStep: document.getElementById('btn-step'),
        btnPlay: document.getElementById('btn-play'),
        speedSlider: document.getElementById('speed-slider'),
        tapeContainer: document.getElementById('sim-tape'),
        resultBadge: document.getElementById('sim-result')
    };

    // NFA: Epsilon closure is a core concept
    function getEpsilonClosure(stateIds) {
        const closure = new Set(stateIds);
        const stack = [...stateIds];

        while (stack.length > 0) {
            const currentId = stack.pop();
            appState.edges.filter(e => e.from === currentId && e.symbols.includes('ε')).forEach(e => {
                if (!closure.has(e.to)) {
                    closure.add(e.to);
                    stack.push(e.to);
                }
            });
        }
        return Array.from(closure);
    }

    function resetSim() {
        clearTimeout(appState.sim.intervalId);
        const inputStr = uiControls.input.value.trim();
        appState.sim.tape = inputStr.split('');
        appState.sim.head = 0;
        appState.sim.status = 'idle';
        uiControls.btnPlay.textContent = '▶️ Play';

        // Render tape
        uiControls.tapeContainer.innerHTML = '';
        appState.sim.tape.forEach((char) => {
            const cell = document.createElement('div');
            cell.className = 'tape-cell';
            cell.textContent = char;
            uiControls.tapeContainer.appendChild(cell);
        });

        uiControls.resultBadge.className = 'result-badge';
        uiControls.resultBadge.textContent = '';

        // NFA: ALL start states are initial, with epsilon closure
        const startNodes = appState.nodes.filter(n => n.isStart).map(n => n.id);
        if (startNodes.length === 0) {
            appState.sim.activeStates = [];
        } else {
            appState.sim.activeStates = getEpsilonClosure(startNodes);
        }

        // Update status with active state count
        updateActiveStatesDisplay();
        updateRender();
    }

    function updateActiveStatesDisplay() {
        const count = appState.sim.activeStates.length;
        const labels = appState.sim.activeStates.map(id => {
            const node = appState.nodes.find(n => n.id === id);
            return node ? node.label : id;
        }).join(', ');
        if (count > 0) {
            document.getElementById('status-message').textContent =
                `Active states (${count}): {${labels}}`;
        }
    }

    function stepSim() {
        if (appState.sim.status === 'accepted' || appState.sim.status === 'rejected') return false;
        if (appState.sim.activeStates.length === 0) {
            autoReject();
            return false;
        }

        if (appState.sim.head >= appState.sim.tape.length) {
            checkAcceptance();
            return false;
        }

        const symbol = appState.sim.tape[appState.sim.head];

        // NFA: explore ALL possible transitions from ALL active states
        let nextStates = new Set();
        let usedTransitions = new Set();

        appState.sim.activeStates.forEach(stateId => {
            appState.edges.forEach(edge => {
                if (edge.from === stateId && edge.symbols.includes(symbol)) {
                    nextStates.add(edge.to);
                    usedTransitions.add(edge.id);
                }
            });
        });

        // Apply epsilon closure to the result
        appState.sim.activeStates = getEpsilonClosure(Array.from(nextStates));

        // Mark transitioned edges briefly active
        usedTransitions.forEach(eId => {
            const g = document.querySelector(`g.transition[data-id="${eId}"]`);
            if (g) {
                g.classList.add('active-sim');
                setTimeout(() => g.classList.remove('active-sim'), 300);
            }
        });

        // update tape UI
        const cells = uiControls.tapeContainer.children;
        if (cells[appState.sim.head]) {
            cells[appState.sim.head].classList.remove('active');
            cells[appState.sim.head].classList.add('consumed');
        }

        appState.sim.head++;

        if (cells[appState.sim.head]) {
            cells[appState.sim.head].classList.add('active');
        }

        updateActiveStatesDisplay();
        updateRender();

        if (appState.sim.head >= appState.sim.tape.length) {
            checkAcceptance();
            return false;
        }

        return true;
    }

    function checkAcceptance() {
        const hasAccepting = appState.sim.activeStates.some(id => {
            const node = appState.nodes.find(n => n.id === id);
            return node && node.isAccept;
        });

        if (hasAccepting) {
            appState.sim.status = 'accepted';
            uiControls.resultBadge.className = 'result-badge accepted';
            uiControls.resultBadge.textContent = 'Accepted';
        } else {
            appState.sim.status = 'rejected';
            uiControls.resultBadge.className = 'result-badge rejected';
            uiControls.resultBadge.textContent = 'Rejected';
        }
        uiControls.btnPlay.textContent = '▶️ Play';
    }

    function autoReject() {
        appState.sim.status = 'rejected';
        uiControls.resultBadge.className = 'result-badge rejected';
        uiControls.resultBadge.textContent = 'Rejected - No Active States';
        uiControls.btnPlay.textContent = '▶️ Play';
    }

    uiControls.btnReset.addEventListener('click', resetSim);
    uiControls.btnStep.addEventListener('click', () => { stepSim(); });

    uiControls.input.addEventListener('input', resetSim);

    uiControls.btnPlay.addEventListener('click', () => {
        if (appState.sim.status === 'playing') {
            clearTimeout(appState.sim.intervalId);
            appState.sim.status = 'idle';
            uiControls.btnPlay.textContent = '▶️ Play';
        } else {
            if (appState.sim.status === 'idle') {
                if (appState.sim.head >= appState.sim.tape.length && appState.sim.tape.length > 0) {
                    resetSim();
                }
            } else if (appState.sim.status === 'accepted' || appState.sim.status === 'rejected') {
                resetSim();
            }

            appState.sim.status = 'playing';
            uiControls.btnPlay.textContent = '⏸️ Pause';

            const playStep = () => {
                if (appState.sim.status !== 'playing') return;

                const hasMore = stepSim();
                if (hasMore) {
                    const speed = 2100 - parseInt(uiControls.speedSlider.value);
                    appState.sim.intervalId = setTimeout(playStep, speed);
                } else {
                    appState.sim.status = 'idle';
                }
            };

            const cells = uiControls.tapeContainer.children;
            if (cells[appState.sim.head]) {
                cells[appState.sim.head].classList.add('active');
            }

            const initialSpeed = 2100 - parseInt(uiControls.speedSlider.value);
            appState.sim.intervalId = setTimeout(playStep, initialSpeed);
        }
    });

    // Patch updateRender to handle active visual states
    const originalUpdateRender = updateRender;
    updateRender = function () {
        originalUpdateRender();

        // Highlight ALL active states (NFA may have multiple)
        if (appState.sim && appState.sim.activeStates) {
            appState.sim.activeStates.forEach(id => {
                const g = document.querySelector(`g.state[data-id="${id}"]`);
                if (g) g.classList.add('active-sim');
            });
        }
    };

});
