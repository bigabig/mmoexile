import * as THREE from "three";

export class CameraController {
  public camera: THREE.PerspectiveCamera;
  private currentTarget = new THREE.Vector3(20, 0, 20);
  private desiredTarget = new THREE.Vector3(20, 0, 20);

  // Isometric angles
  public azimuthAngle = 0; // Rotated by Q/E (radians)
  private targetAzimuth = 0;
  private elevationAngle = (55 * Math.PI) / 180; // 55 degrees tilt
  public distance = 22; // Distance from player

  // Off-centering (RotMG feature)
  public isOffCenter = true;
  private offCenterOffset = new THREE.Vector3();

  // Raycasting for ground aim
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Y = 0
  private mouseNDC = new THREE.Vector2();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.updateCameraTransform();
  }

  public resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  public setFollowTarget(x: number, z: number): void {
    this.desiredTarget.set(x, 0, z);
  }

  public rotateLeft(): void {
    this.targetAzimuth -= Math.PI / 4; // -45 deg
  }

  public rotateRight(): void {
    this.targetAzimuth += Math.PI / 4; // +45 deg
  }

  public toggleOffCenter(): void {
    this.isOffCenter = !this.isOffCenter;
  }

  public updateMouseNDC(
    clientX: number,
    clientY: number,
    width: number,
    height: number,
  ): void {
    this.mouseNDC.x = (clientX / width) * 2 - 1;
    this.mouseNDC.y = -(clientY / height) * 2 + 1;
  }

  /**
   * Raycasts from camera through mouse cursor onto ground plane Y = 0
   */
  public getGroundAimPoint(): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.mouseNDC, this.camera);
    const hit = new THREE.Vector3();
    const result = this.raycaster.ray.intersectPlane(this.groundPlane, hit);
    return result ? hit : null;
  }

  public update(dt: number): void {
    // Smooth target follow
    this.currentTarget.lerp(this.desiredTarget, Math.min(1.0, dt * 10));

    // Smooth camera rotation
    this.azimuthAngle +=
      (this.targetAzimuth - this.azimuthAngle) * Math.min(1.0, dt * 12);

    // Calculate off-center offset towards aim if enabled
    if (this.isOffCenter) {
      const aim = this.getGroundAimPoint();
      if (aim) {
        const dx = aim.x - this.currentTarget.x;
        const dz = aim.z - this.currentTarget.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const maxOffset = 3.5;
        if (dist > 0.01) {
          const factor = Math.min(maxOffset, dist) / dist;
          this.offCenterOffset.set(dx * factor * 0.6, 0, dz * factor * 0.6);
        }
      }
    } else {
      this.offCenterOffset.set(0, 0, 0);
    }

    this.updateCameraTransform();
  }

  private updateCameraTransform(): void {
    const lookAtPos = this.currentTarget.clone().add(this.offCenterOffset);

    // Spherical coordinate offset
    const cosElev = Math.cos(this.elevationAngle);
    const sinElev = Math.sin(this.elevationAngle);
    const sinAzim = Math.sin(this.azimuthAngle);
    const cosAzim = Math.cos(this.azimuthAngle);

    const camX = lookAtPos.x + this.distance * cosElev * sinAzim;
    const camY = lookAtPos.y + this.distance * sinElev;
    const camZ = lookAtPos.z + this.distance * cosElev * cosAzim;

    this.camera.position.set(camX, camY, camZ);
    this.camera.lookAt(lookAtPos);
  }
}
