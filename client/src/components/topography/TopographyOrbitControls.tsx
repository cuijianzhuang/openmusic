import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  DEFAULT_TOPOGRAPHY_CAMERA_STATE,
  TOPOGRAPHY_CAMERA_STATE_STORAGE_KEY,
} from './lib/topographySceneDefaults';

interface Props {
  cameraDistance?: number;
}

const TopographyOrbitControls = forwardRef<OrbitControls | null, Props>(function TopographyOrbitControls(
  { cameraDistance = 1 },
  ref,
) {
  const { camera, gl } = useThree();
  const controlsRef = useRef<OrbitControls | null>(null);
  const distScale = Math.max(0.55, Math.min(1.65, cameraDistance));

  useImperativeHandle(ref, () => controlsRef.current!);

  useEffect(() => {
    const controls = new OrbitControls(camera, gl.domElement);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 5 * distScale;
    controls.maxDistance = 120 * distScale;
    controls.maxPolarAngle = Math.PI / 2 - 0.1;
    controls.target.set(
      DEFAULT_TOPOGRAPHY_CAMERA_STATE.target.x,
      DEFAULT_TOPOGRAPHY_CAMERA_STATE.target.y,
      DEFAULT_TOPOGRAPHY_CAMERA_STATE.target.z,
    );
    camera.position.set(
      DEFAULT_TOPOGRAPHY_CAMERA_STATE.position.x * distScale,
      DEFAULT_TOPOGRAPHY_CAMERA_STATE.position.y * distScale,
      DEFAULT_TOPOGRAPHY_CAMERA_STATE.position.z * distScale,
    );
    controls.update();
    controlsRef.current = controls;

    const saveState = () => {
      if (!controlsRef.current) return;
      localStorage.setItem(
        TOPOGRAPHY_CAMERA_STATE_STORAGE_KEY,
        JSON.stringify({
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          target: {
            x: controlsRef.current.target.x,
            y: controlsRef.current.target.y,
            z: controlsRef.current.target.z,
          },
        }),
      );
    };
    window.addEventListener('beforeunload', saveState);

    return () => {
      saveState();
      window.removeEventListener('beforeunload', saveState);
      controls.dispose();
      controlsRef.current = null;
    };
  }, [camera, gl, distScale]);

  useFrame(() => {
    controlsRef.current?.update();
  });

  return null;
});

export default TopographyOrbitControls;
