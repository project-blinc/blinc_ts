import ashui.core.render.Offscreen;
import ashui.core.render.Renderer;
import ashui.core.render.Png;
import ashui.layout.DisplayList;
import gpu.GpuTextureViewDescriptor;

@:access(ashui.layout.DisplayList)
@:access(ashui.ui.Canvas)
class RendererReference {
  static function main() {
    var dir = Sys.getEnv("RENDER_REFERENCE_DIR");
    var offscreen = Offscreen.create();
    var renderer = new Renderer(offscreen.device, gpu.TextureFormat.Rgba8unorm);
    // A real CanvasFrame callback consumes the same records for the canvas fixture.
    var canvasTree = new ashui.layout.LayoutTree();
    var canvas = new ashui.ui.Canvas({paint: frame -> frame.draw(CanvasReferenceShader.WGSL, 6)}, [], canvasTree);
    for (slot in 0...5) ashui.ui.Canvas.bySlot.set(slot, canvas);
    var names = Sys.getEnv("RENDER_REFERENCE_NAMES");
    for (name in (names == null ? ["geometry", "squircle", "fractional"] : names.split(","))) for (scale in [1, 2]) {
      var data:Dynamic = haxe.Json.parse(sys.io.File.getContent(dir + '/records-${name}-${scale}x.json'));
      var records:Array<Float> = data.records;
      var count:Int = data.count;
      var list = new DisplayList();
      list.count = count;
      list.stored = count;
      var rows = Math.ceil(count / DisplayList.RECORDS_PER_ROW);
      list.bytes = haxe.io.Bytes.alloc(rows * DisplayList.ROW_TEXELS * 16);
      for (i in 0...records.length) list.bytes.setFloat(i * 4, records[i]);
      var width:Int = data.width;
      var height:Int = data.height;
      var texture = offscreen.createTexture(width * scale, height * scale);
      var view = texture.createView(new GpuTextureViewDescriptor());
      renderer.draw(list, view, width, height, 0, 0, 0, 0, width * scale, height * scale);
      var pixels = offscreen.readRgba8(texture, width * scale, height * scale);
      sys.io.File.saveBytes(dir + '/reference-${name}-${scale}x.png', Png.encode(width * scale, height * scale, pixels));
      view.destroy(); texture.destroy();
      Sys.println('reference $name ${scale}x: $count primitives');
    }
  }
}

class CanvasReferenceShader implements ashui.core.render.UiShader {
  static var SRC = {
    @:import ashui.core.render.Sdf;
    var output : { position : Vec4, color : Vec4 };
    var pixel : Vec2;
    var uv : Vec2;
    function vertex() {
      var b = primitive.bounds;
      uv = quadCorner(vertexID);
      pixel = placed(b.xy, primitive.affine, uv * b.zw);
      output.position = pixelToClip(pixel, viewport);
    }
    function fragment() {
      output.color = vec4(primitive.color.rgb * mix(0.65, 1., uv.x), canvasClip(pixel));
    }
  };
}
