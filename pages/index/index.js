import { errorHandler, showAuthModal, getCameraAuth, resUrl, getSlamV2Support } from "../../utils/util";
import { stats, getTimeLevel } from "../../utils/stats";
import Castle from "./Castle";

const steps = ["findPlane", "showPoint", "startScene"]; // 一些UI限制的步骤

Page({
  data: {
    showSlam: false,
    // 去除水印需要申请license，见 README.md
    // license:
    //   "ad51dc82b4846b28943338eeaac37f560345bbdba05a91a7aa5da0768d87ca5fea23cbbf1a4772785d92c7d2baaf0b88f373a0dd9c4a1c8bd8184a2f53bd59e0",
    scanImg: resUrl("images/scaning.png"),
    step: "",
    version: "v1",
  },
  async onLoad() {
    const isSupportV2 = getSlamV2Support();
    if(isSupportV2) {
      this.setData({version: "v2"});
    }

    this.loading = this.selectComponent("#loading");

    this.loading.show();

    // 此处使用会获取摄像头的权限，直到同意后才会初始化slam以免摄像头报错导致无法初始化。
    await getCameraAuth();

    this.setData({ showSlam: true });

    // 设置屏幕常亮
    wx.setKeepScreenOn({
      keepScreenOn: true,
    });

    this.castle = new Castle();
    // 提前下载素材
    this.castle.loadAssets();

    // 此处是埋点
    this.startInitTime = Date.now();
    stats("loading_start");
  },

  onShareAppMessage: function (res) {
    return {
      title: '新年快乐，大展红兔',
      imageUrl: '/static/images/cover_rabbit.jpeg'
    }
  },

  onUnload() {
    this.castle.clear();

    this.castle = null;
    this.loading = null;
    this.videoPlayer = null;
    this.audioPlayer = null;
  },

  async ready({ detail: slam }) {
    try {
      // 初始化场景
      const loadingTime = await this.castle.initScene(slam);
      // console.warn("isSlamV2", this.castle.slam.isSlamV2())

      this.findPlane();
      this.loading.hidden();

      stats("ar_start", { ...loadingTime, loadingDuration: getTimeLevel(this.startInitTime) });
      this.readyTime = Date.now();
    } catch (e) {
      this.loading.hidden();
      errorHandler(e);
    }
  },

  // 寻找屏幕
  findPlane() {
    this.setData({ step: steps[0] });

    if (this.data.version === "v1") {
      setTimeout(() => {
        this.setData({ step: steps[1] });
        this.castle.findPlane();
      }, 3000);
    }
  },

  // v2模式下有平面新增
  addAnchors() {
    this.setData({ step: steps[1] });
    this.castle.findPlane();
  },

  // 开始场景展示
  startScene() {
    if (this.data.step !== steps[1]) {
      return;
    }
    try {
      this.castle.startScene();
      this.setData({ step: "" });

      setTimeout(() => {
        this.setData({ step: steps[2] });

        wx.nextTick(() => {
          this.audioPlayer = this.selectComponent("#audioPlayer");
          this.videoPlayer = this.selectComponent("#videoPlayer");
          this.audioPlayer.play();
          this.videoPlayer.play();
        });
      }, 2000);

      stats("ar_show_arScene", { arAnchorDuration: getTimeLevel(this.readyTime) });
    } catch (err) {
      wx.showToast({ title: "放置模型失败，请对准平面", icon: "none" });
    }
  },

  playVideo() {
    this.audioPlayer.pause();
  },

  closeVideo() {
    this.audioPlayer.play();
  },

  error({ detail }) {
    // 判定是否camera权限问题，是则向用户申请权限。
    if (detail?.isCameraAuthDenied) {
      showAuthModal(this);
    } else {
      errorHandler(detail);
    }
  },

});
