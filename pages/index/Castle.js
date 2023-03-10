import { requestFile, downloadFile, resUrl } from "../../utils/util";
import { getTimeLevel } from "../../utils/stats";

class Castle {
  constructor() {}

  /**
   * 下载场景必要素材
   * @return Promise
   * @memberof Castle
   */
  loadAssets() {
    if (this.downloadAssets) {
      return this.downloadAssets;
    }
    const downloadStartTime = Date.now();

    this.downloadAssets = Promise.all([
      requestFile(resUrl("model/rabbit_dancing.glb")),
      requestFile(resUrl("media/default.hdr")),
      downloadFile(resUrl("media/point.mp4")),
      downloadFile(resUrl("media/snow-animate-compressed-2.mp4")),
    ]).then((res) => {
      this.assetDownloadDuration = getTimeLevel(downloadStartTime); // 统计下载持续时间
      return res;
    });

    return this.downloadAssets;
  }

  /**
   * 初始化场景和模型，但此时还没有将模型加入到场景内。
   * 只能在slam组件ready后使用
   * @param {*} slam 传入的slam对象
   * @memberof Castle
   */
  async initScene(slam) {
    try {
      const [
        modelArrayBuffer,
        envMapArrayBuffer,
        planeAlphaVideoPath,
        snowAlphaVideoPath,
      ] = await this.loadAssets();

      const modelLoadStartTime = Date.now();

      // 当视频因为特殊原因不能显示时，会使用此处指定的缩略图展示。为空则降级缩略图功能无效。
      const defaultThumbnailUrl = "/static/images/video.png";
      const [castle, envMap, indicatorModel, snowModel] = await Promise.all([
        slam.createGltfModel(modelArrayBuffer),
        slam.createEnvMapByHDR(envMapArrayBuffer),
        slam.createAlphaVideo(planeAlphaVideoPath, defaultThumbnailUrl),
        slam.createAlphaVideo(snowAlphaVideoPath, defaultThumbnailUrl),
      ]);

      const assetLoadDuration = getTimeLevel(modelLoadStartTime);

      // 模型使用上环境贴图，可加强真实效果。实物类模型推荐使用。
      castle.useEnvMap(envMap);

      // 开启模型投射阴影属性是否投射。true为开启投射，false为关闭投射。
      castle.setCastShadow(true);
      castle.scale.setScalar(100);
      castle.playAnimation({ loop: true });

      snowModel.loop = true; // 设置为循环播放
      snowModel.position.set(0, 30, 0);
      snowModel.scale.setScalar(20);

      this.castle = castle;
      this.snow = snowModel;

      // 创建一个模型组
      const group = slam.createGroup();
      group.add(castle);
      group.add(snowModel);

      // v2版本放置到空间中的模型大小更精准，这里需要做下处理
      const initScale = slam.isSlamV2() ? 0.5 : 1.5;
      const initRotation = 0; // 角度
      /**
       * 将创建好的3D对象，放入组件之中显示。
       * @param {Base3D} base3D - 3D对象
       * @param {Number} [scale=0] - 3D对象初始大小，0代表不指定大小，使用模型原始大小。单位“米”，默认值为0。注意：此大小仅供参考，不能视作精准值，会存在一定的误差。
       * @param {Number} [rotation=0] - 3D对象初始Y轴旋转朝向，0代表不进行旋转。单位“角度”，默认值为0。
       * @returns {void}
       */
      slam.add(group, initScale, initRotation);

      group.visible = false; // 在没有将模型放到平面前需要先隐藏模型

      // 让模型可用手势进行操作。默认点击移动到平面上的新位置，单指旋转，双指缩放。
      slam.setGesture(group);

      this.model = group;

      // 增加指示器
      indicatorModel.name = "indicatorModel";
      indicatorModel.loop = true; // 设置为循环播放
      const indicatorScale = slam.isSlamV2() ? 0.075 : 0.25;
      indicatorModel.scale.setScalar(indicatorScale);

      /**
       * 此指示器模型使用的是透明视频模型，
       * 透明视频模型默认是垂直于Z轴，所以需要旋转为平方状态
       * **/
      indicatorModel.rotation.x = Math.PI / 2;

      // 由于slam放置时内部会改变模型的旋转，所以这里使用一个父级group进行包裹
      const indicatorGroup = slam.createGroup();
      indicatorGroup.add(indicatorModel);

      this.indicatorModel = indicatorGroup;

      slam.enableShadow(); // 开启阴影功能
      await slam.start();

      this.slam = slam;

      return {
        assetDownloadDuration: this.assetDownloadDuration,
        assetLoadDuration,
      };
    } catch (e) {
      throw new Error(e.message);
    }
  }

  /**
   * 找平面
   * @memberof Castle
   */
  findPlane() {
    const { slam, indicatorModel } = this;
    // 增加一个3d素材作为平面指示器显示。
    slam.addPlaneIndicator(indicatorModel, {
      // camera画面中心，可以映射到平面上某一个点时调用
      onPlaneShow() {
        // console.log("指示器出现");
      },
      // camera画面中心，**不可以**映射到平面上某一个点时调用。
      onPlaneHide() {
        // console.log("指示器隐藏");
      },
      // camera画面中心，可以映射到平面上某一个点时，**持续**调用。
      // 因此可以用此方法，让指示器旋转起来。
      onPlaneShowing() {},
    });

    // indicatorModel.videoContext.play();
    indicatorModel.visible = true;
  }

  /**
   * 开始场景，将设定好的模型加入到场景内
   * @memberof Castle
   */
  startScene() {
    const { slam, model, indicatorModel, castle, snow } = this;

    // 注意：只有开启slam平面追踪(slam.start())之后，才能让模型去尝试站在平面上。
    const { windowWidth, windowHeight } = wx.getSystemInfoSync();
    // 主动让模型站在屏幕中心映射到平面上的位置点。
    // 此处组件全屏展示，所以窗口宽度除以2
    const x = Math.round(windowWidth / 2);
    // 此处组件全屏展示，所以窗口高度除以2
    const y = Math.round(windowHeight / 2);
    // 首次调用standOnThePlane，resetPlane参数必须设为true，以便确定一个平面。
    // 如果为false，代表使用已经检测到的平面。默认为true。
    const resetPlane = true;
    /**
     * 让3D素材对象，站立在检测出来的平面之上。
     * @param {Base3D} base3D - 3D对象
     * @param {Number} x - kivicube-slam组件上的x轴横向坐标点
     * @param {Number} y - kivicube-slam组件上的y轴纵向坐标点
     * @param {Boolean} [resetPlane=true] - 是否重置平面。
     * @returns {Boolean} 是否成功站立在平面上
     */
    const success = slam.standOnThePlane(model, x, y, resetPlane);

    if (!success) {
      // 如果返回false，代表尝试站在平面上失败。有可能是平面检测失败。
      throw new Error("find plane failed");
    }

    // indicatorModel.videoContext.stop();
    slam.removePlaneIndicator(); // 移除指示器

    model.visible = true;

    castle.playAnimation({
      animationName: "start",
      loop: false, // 是否循环播放
    });

    // 播放牛排的动画
    castle.playAnimation({ animationName: "loop", loop: true });

    snow.videoContext.play();

    // 模型动画监听
    castle.addEventListener("animationEnded", (e) => {
      if (e.animationName === "start") {
        castle.stopAnimation("start");
        castle.playAnimation({ animationName: "loop2", loop: true });
      }
    });
  }

  // 清理
  clear() {
    this.slam = null;
    this.model = null;
    this.downloadAssets = null;
  }
}

export default Castle;
