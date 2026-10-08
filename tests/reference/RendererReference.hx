import ashui.core.render.Offscreen;
import ashui.core.render.Renderer;
import ashui.core.render.Png;
import ashui.layout.DisplayList;
import gpu.GpuTextureViewDescriptor;

@:access(ashui.layout.DisplayList)
class RendererReference {
  static function main() {
    var dir = Sys.getEnv("RENDER_REFERENCE_DIR");
    var offscreen = Offscreen.create();
    var renderer = new Renderer(offscreen.device, gpu.TextureFormat.Rgba8unorm);
    for (name in ["geometry", "squircle", "fractional"]) for (scale in [1, 2]) {
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
