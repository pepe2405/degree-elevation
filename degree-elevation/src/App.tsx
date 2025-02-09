import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import './App.css';

const App: React.FC = () => {
  // Референтни променливи за контейнера, сцената, камерата и рендера
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene>(null);
  const cameraRef = useRef<THREE.OrthographicCamera>(null);
  const rendererRef = useRef<THREE.WebGLRenderer>(null);

  // Състояния за контролите в долната лента
  const [showControlPolygon, setShowControlPolygon] = useState(true);
  const [showIntermediatePolygons, setShowIntermediatePolygons] = useState(true);
  const [elevationSteps, setElevationSteps] = useState(1);
  const [fps, setFps] = useState(0);
  // Нов state за броя на контролните точки
  const [pointCount, setPointCount] = useState(0);

  // Създаваме ref-ове, за да пазим актуалните стойности на състоянието
  const showControlPolygonRef = useRef(showControlPolygon);
  const showIntermediatePolygonsRef = useRef(showIntermediatePolygons);
  const elevationStepsRef = useRef(elevationSteps);

  useEffect(() => {
    showControlPolygonRef.current = showControlPolygon;
  }, [showControlPolygon]);
  useEffect(() => {
    showIntermediatePolygonsRef.current = showIntermediatePolygons;
  }, [showIntermediatePolygons]);
  useEffect(() => {
    elevationStepsRef.current = elevationSteps;
  }, [elevationSteps]);

  // Реф за съхранение на контролните точки (всички точки са в равнината, z = 0)
  const controlPointsRef = useRef<THREE.Vector3[]>([]);

  // Рефове за работа с взаимодействието с мишката
  const draggingPointIndexRef = useRef<number | null>(null);
  const pointerDownPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);

  // Реф за обектите, които добавяме в сцената (за лесно почистване при ъпдейт)
  const drawnObjectsRef = useRef<THREE.Object3D[]>([]);

  // Задаваме фиксирани размери на “canvas”-а
  const width = 600;
  const height = 600;

  // Функция за “degree elevation” (повишаване на степента на Bézier крива)
  // При даден масив от точки P0,...,Pn, новите точки Q се пресмятат по:
  // Q0 = P0, Q_i = (i/(n+1))·P₍ᵢ₋₁₎ + ((n+1-i)/(n+1))·Pᵢ, i=1,…,n и Qₙ₊₁ = Pₙ.
  const degreeElevate = (points: THREE.Vector3[]): THREE.Vector3[] => {
    const n = points.length - 1;
    let newPoints: THREE.Vector3[] = [];
    newPoints.push(points[0].clone());
    for (let i = 1; i <= n; i++) {
      const alpha = i / (n + 1);
      const pPrev = points[i - 1];
      const pCurr = points[i];
      const Q = new THREE.Vector3()
        .copy(pPrev)
        .multiplyScalar(alpha)
        .add(new THREE.Vector3().copy(pCurr).multiplyScalar(1 - alpha));
      newPoints.push(Q);
    }
    newPoints.push(points[n].clone());
    return newPoints;
  };

  // Алгоритъм на de Casteljau за пресмятане на точка от Bézier крива при параметър t
  const deCasteljau = (points: THREE.Vector3[], t: number): THREE.Vector3 => {
    let temp = points.map((p) => p.clone());
    const n = temp.length;
    for (let r = 1; r < n; r++) {
      for (let i = 0; i < n - r; i++) {
        temp[i].lerp(temp[i + 1], t);
      }
    }
    return temp[0];
  };

  // Пресмята точки по Bézier крива чрез пробване на параметъра t от 0 до 1
  const computeBezierCurvePoints = (points: THREE.Vector3[], numSamples: number): THREE.Vector3[] => {
    const curvePoints: THREE.Vector3[] = [];
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      curvePoints.push(deCasteljau(points, t));
    }
    return curvePoints;
  };

  // Функция, която “почиства” и рисува отново сцената – контролни точки, кривата и междинните многоъгълници
  const updateScene = () => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Премахваме предишно добавените обекти от сцената
    drawnObjectsRef.current.forEach((obj) => scene.remove(obj));
    drawnObjectsRef.current = [];

    // Рисуваме всяка контролна точка като по-голям кръг (за по-добра видимост)
    controlPointsRef.current.forEach((point) => {
      const geometry = new THREE.CircleGeometry(10, 32);
      const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const circle = new THREE.Mesh(geometry, material);
      circle.position.copy(point);
      scene.add(circle);
      drawnObjectsRef.current.push(circle);
    });

    // Ако има поне 2 контролни точки – пресмятаме и рисуваме Bézier кривата
    if (controlPointsRef.current.length >= 2) {
      const curvePoints = computeBezierCurvePoints(controlPointsRef.current, 100);
      const curveGeometry = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const curveMaterial = new THREE.LineBasicMaterial({ color: 0x0000ff });
      const curveLine = new THREE.Line(curveGeometry, curveMaterial);
      scene.add(curveLine);
      drawnObjectsRef.current.push(curveLine);
    }

    // Пресмятаме последователно “degree elevation” – получаваме редица от контролни многоъгълници
    if (controlPointsRef.current.length >= 2) {
      const polygonSteps: THREE.Vector3[][] = [];
      let currentPolygon = controlPointsRef.current.map((p) => p.clone());
      polygonSteps.push(currentPolygon);
      const steps = Math.max(0, elevationStepsRef.current);
      for (let i = 0; i < steps; i++) {
        if (currentPolygon.length < 2) break;
        currentPolygon = degreeElevate(currentPolygon);
        polygonSteps.push(currentPolygon);
      }

      // Рисуваме оригиналния контролен многоъгълник (ако е маркиран)
      if (showControlPolygonRef.current && polygonSteps.length > 0) {
        const geometry = new THREE.BufferGeometry().setFromPoints(polygonSteps[0]);
        const material = new THREE.LineBasicMaterial({ color: 0xff0000 });
        const line = new THREE.Line(geometry, material);
        scene.add(line);
        drawnObjectsRef.current.push(line);
      }

      // Рисуваме междинните многоъгълници (ако е маркирано)
      if (showIntermediatePolygonsRef.current && polygonSteps.length > 1) {
        for (let i = 1; i < polygonSteps.length; i++) {
          const geometry = new THREE.BufferGeometry().setFromPoints(polygonSteps[i]);
          const material = new THREE.LineBasicMaterial({ color: 0x00aa00 });
          const line = new THREE.Line(geometry, material);
          scene.add(line);
          drawnObjectsRef.current.push(line);
        }
      }
    }

    // Обновяваме броя на точките
    setPointCount(controlPointsRef.current.length);
  };

  // Функция за изчистване на всички контролни точки от екрана
  const clearScreen = () => {
    controlPointsRef.current = [];
    updateScene();
  };

  // Превръщаме координатите на мишката от събитието в координати спрямо сцената
  const getMousePosition = (event: MouseEvent): { x: number; y: number } => {
    const rect = (mountRef.current as HTMLDivElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = rect.height - (event.clientY - rect.top);
    return { x, y };
  };

  // Обработване на mousedown – добавяне/избиране на точка
  const onPointerDown = (event: MouseEvent) => {
    event.preventDefault();
    const pos = getMousePosition(event);
    pointerDownPosRef.current = pos;
    const threshold = 10; // прагово разстояние (в пиксели)
    let foundIndex: number | null = null;
    controlPointsRef.current.forEach((point, index) => {
      const dx = point.x - pos.x;
      const dy = point.y - pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < threshold) {
        foundIndex = index;
      }
    });
    if (foundIndex !== null) {
      draggingPointIndexRef.current = foundIndex;
      isDraggingRef.current = false;
    } else {
      controlPointsRef.current.push(new THREE.Vector3(pos.x, pos.y, 0));
      updateScene();
    }
  };

  // Обработване на mousemove – ако влачим точка, обновяваме нейната позиция
  const onPointerMove = (event: MouseEvent) => {
    if (draggingPointIndexRef.current === null) return;
    const pos = getMousePosition(event);
    const start = pointerDownPosRef.current;
    if (!isDraggingRef.current) {
      const dx = pos.x - start.x;
      const dy = pos.y - start.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        isDraggingRef.current = true;
      }
    }
    if (isDraggingRef.current && draggingPointIndexRef.current !== null) {
      controlPointsRef.current[draggingPointIndexRef.current].set(pos.x, pos.y, 0);
      updateScene();
    }
  };

  // Обработване на mouseup – ако точката не е влачена, я премахваме (втори клик)
  const onPointerUp = (event: MouseEvent) => {
    if (draggingPointIndexRef.current !== null) {
      if (!isDraggingRef.current) {
        controlPointsRef.current.splice(draggingPointIndexRef.current, 1);
      }
      draggingPointIndexRef.current = null;
      isDraggingRef.current = false;
      updateScene();
    }
  };

  // Инициализация на Three.js сцената, камерата, рендера и анимационния цикъл
  useEffect(() => {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff); // бял фон
    sceneRef.current = scene;

    const camera = new THREE.OrthographicCamera(0, width, height, 0, -1000, 1000);
    camera.position.z = 10;
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    rendererRef.current = renderer;

    if (mountRef.current) {
      mountRef.current.appendChild(renderer.domElement);
    }

    const canvas = renderer.domElement;
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    canvas.addEventListener('mouseup', onPointerUp);
    canvas.addEventListener('mouseleave', onPointerUp);

    let frameCount = 0;
    let lastTime = performance.now();
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);

      frameCount++;
      const now = performance.now();
      const delta = now - lastTime;
      if (delta >= 1000) {
        setFps(Math.round((frameCount * 1000) / delta));
        frameCount = 0;
        lastTime = now;
      }
    };
    animate();

    return () => {
      canvas.removeEventListener('mousedown', onPointerDown);
      canvas.removeEventListener('mousemove', onPointerMove);
      canvas.removeEventListener('mouseup', onPointerUp);
      canvas.removeEventListener('mouseleave', onPointerUp);
      if (mountRef.current) {
        mountRef.current.removeChild(renderer.domElement);
      }
    };
  }, []);

  // При смяна на настройките за контрол (checkbox-и или брой степени) обновяваме сцената
  useEffect(() => {
    updateScene();
  }, [showControlPolygon, showIntermediatePolygons, elevationSteps]);

  return (
    <div className="App">
      <div style={{ border: '1px solid black', display: 'inline-block' }} ref={mountRef}></div>
      <div style={{ marginTop: '10px' }}>
        <label>
          <input
            type="checkbox"
            checked={showControlPolygon}
            onChange={(e) => setShowControlPolygon(e.target.checked)}
          />
          Show Control Polygon
        </label>
        <label style={{ marginLeft: '10px' }}>
          <input
            type="checkbox"
            checked={showIntermediatePolygons}
            onChange={(e) => setShowIntermediatePolygons(e.target.checked)}
          />
          Show Intermediate Polygons
        </label>
        <label style={{ marginLeft: '10px' }}>
          Degrees:
          <input
            type="number"
            value={elevationSteps}
            onChange={(e) => setElevationSteps(parseInt(e.target.value) || 0)}
            style={{ width: '50px', marginLeft: '5px' }}
          />
        </label>
        <label style={{ marginLeft: '10px' }}>FPS: {fps}</label>
        {/* Поле, показващо броя на контролните точки */}
        <label style={{ marginLeft: '10px' }}>Points: {pointCount}</label>
        <button type="button" onClick={clearScreen} style={{ marginLeft: '10px' }}>
          Clear Screen
        </button>
      </div>
    </div>
  );
};

export default App;
