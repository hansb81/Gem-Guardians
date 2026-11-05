// 스프라이트 시트 애니메이션 최소 구현 - 아직 연결된 에셋은 없지만(effects.json에서
// 참조 안 함), 나중에 "frameCount장을 frameTimeMs마다 넘기는 가로 1줄 스프라이트 시트"가
// 추가되면 바로 쓸 수 있게 프레임 계산 + draw만 제공한다.
export class SpriteAnimation {
  constructor({ image, frameCount, frameTimeMs }) {
    this.image = image;
    this.frameCount = frameCount;
    this.frameTimeMs = frameTimeMs;
  }

  // elapsedMs 기준 현재 프레임 인덱스(마지막 프레임에서 멈춤, 루프하지 않음).
  frameAt(elapsedMs) {
    const idx = Math.floor(elapsedMs / this.frameTimeMs);
    return Math.min(this.frameCount - 1, Math.max(0, idx));
  }

  draw(ctx, elapsedMs, x, y, size) {
    const frame = this.frameAt(elapsedMs);
    const frameWidth = this.image.width / this.frameCount;
    const frameHeight = this.image.height;
    ctx.drawImage(this.image, frame * frameWidth, 0, frameWidth, frameHeight, x, y, size, size);
  }
}
