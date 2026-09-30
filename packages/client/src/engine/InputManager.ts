import { CameraController } from "./CameraController.js";

export interface MovementInput {
  moveX: number; // World X movement (-1..1)
  moveY: number; // World Z movement (-1..1) (mapped to 2D Y)
  angle: number; // Aim angle in radians
}

export class InputManager {
  private keys = new Set<string>();
  private isMouseDown = false;
  private cameraCtrl: CameraController;
  private canvas: HTMLCanvasElement;

  public onInteract?: () => void;
  public onOpenChat?: () => void;
  public onToggleCharacterSheet?: () => void;
  public onToggleInventory?: () => void;
  public onLootFirst?: () => void;
  public onLootAll?: () => void;
  public onCloseModals?: () => void;
  public isChatFocused = false;
  public isLootModalOpen = false;

  constructor(canvas: HTMLCanvasElement, cameraCtrl: CameraController) {
    this.canvas = canvas;
    this.cameraCtrl = cameraCtrl;

    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  public dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mouseup", this.handleMouseUp);
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (this.isChatFocused) {
      if (e.key === "Escape") {
        this.isChatFocused = false;
      }
      return;
    }

    if (e.key === "Enter") {
      this.onOpenChat?.();
      return;
    }

    this.keys.add(e.code);

    if (e.code === "KeyQ") {
      this.cameraCtrl.rotateLeft();
    } else if (e.code === "KeyE") {
      // E can be rotate or portal interact; let's trigger interact when pressed
      this.onInteract?.();
    } else if (e.code === "KeyR") {
      this.cameraCtrl.rotateRight();
    } else if (e.code === "KeyZ") {
      this.cameraCtrl.toggleOffCenter();
    } else if (e.code === "KeyC") {
      this.onToggleCharacterSheet?.();
    } else if (e.code === "KeyI" || e.code === "KeyB") {
      this.onToggleInventory?.();
    } else if (e.code === "KeyF") {
      this.onLootFirst?.();
    } else if (e.code === "Space" && this.isLootModalOpen) {
      this.onLootAll?.();
    } else if (e.code === "Escape") {
      this.onCloseModals?.();
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private handleMouseMove = (e: MouseEvent) => {
    this.cameraCtrl.updateMouseNDC(
      e.clientX,
      e.clientY,
      window.innerWidth,
      window.innerHeight,
    );
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (this.isChatFocused) return;
    if (e.button === 0) {
      this.isMouseDown = true;
    } else if (e.button === 1) {
      // Middle click: toggle off-centering
      this.cameraCtrl.toggleOffCenter();
    }
  };

  private handleMouseUp = (e: MouseEvent) => {
    if (e.button === 0) {
      this.isMouseDown = false;
    }
  };

  public isShooting(): boolean {
    if (this.isChatFocused) return false;
    if (this.isLootModalOpen) {
      return this.isMouseDown;
    }
    return this.isMouseDown || this.keys.has("Space");
  }

  /**
   * Computes movement vector relative to camera's orientation
   */
  public getMovementInput(playerWorldPos: {
    x: number;
    y: number;
  }): MovementInput {
    if (this.isChatFocused) {
      return { moveX: 0, moveY: 0, angle: 0 };
    }

    let inputForward = 0;
    let inputRight = 0;

    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) inputForward += 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) inputForward -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) inputRight += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) inputRight -= 1;

    // Camera view angle on ground:
    const theta = this.cameraCtrl.azimuthAngle;
    const forwardX = -Math.sin(theta);
    const forwardY = -Math.cos(theta);
    const rightX = Math.cos(theta);
    const rightY = -Math.sin(theta);

    let moveX = forwardX * inputForward + rightX * inputRight;
    let moveY = forwardY * inputForward + rightY * inputRight;

    const len = Math.sqrt(moveX * moveX + moveY * moveY);
    if (len > 0.0001) {
      moveX /= len;
      moveY /= len;
    }

    // Aim angle from ground raycasting
    const aimHit = this.cameraCtrl.getGroundAimPoint();
    let aimAngle = 0;
    if (aimHit) {
      aimAngle = Math.atan2(
        aimHit.z - playerWorldPos.y,
        aimHit.x - playerWorldPos.x,
      );
    }

    return { moveX, moveY, angle: aimAngle };
  }
}
