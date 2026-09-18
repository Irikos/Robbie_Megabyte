// Calls the installed Humble plugin, without rclcpp::init, DDS or publishers.
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <yaml-cpp/yaml.h>
#include <nav2_regulated_pure_pursuit_controller/regulated_pure_pursuit_controller.hpp>

class Probe : public nav2_regulated_pure_pursuit_controller::RegulatedPurePursuitController {
public:
  explicit Probe(const YAML::Node & c) {
    const auto f = c["FollowPath"];
    use_rotate_to_heading_ = f["use_rotate_to_heading"].as<bool>();
    use_velocity_scaled_lookahead_dist_ = f["use_velocity_scaled_lookahead_dist"].as<bool>();
    lookahead_dist_ = f["lookahead_dist"].as<double>();
    min_lookahead_dist_ = f["min_lookahead_dist"].as<double>();
    max_lookahead_dist_ = f["max_lookahead_dist"].as<double>();
    lookahead_time_ = f["lookahead_time"].as<double>();
    rotate_to_heading_min_angle_ = f["rotate_to_heading_min_angle"].as<double>();
    goal_dist_tol_ = c["goal_checker"]["xy_goal_tolerance"].as<double>();
    use_interpolation_ = f["use_interpolation"].as<bool>();
  }

  int mode(double distance, double heading, double speed) {
    nav_msgs::msg::Path path;
    // Straight path in base_link, dense enough to exercise interpolation.
    for (int i = 0; i <= 100; ++i) {
      geometry_msgs::msg::PoseStamped p;
      p.pose.position.x = distance * i / 100.0 * std::cos(heading);
      p.pose.position.y = distance * i / 100.0 * std::sin(heading);
      p.pose.orientation.w = 1.0;
      path.poses.push_back(p);
    }
    geometry_msgs::msg::Twist measured;
    measured.linear.x = speed;
    const auto carrot = getLookAheadPoint(getLookAheadDistance(measured), path);
    if (shouldRotateToGoalHeading(carrot)) return 2;
    double angle;
    if (shouldRotateToPath(carrot, angle)) return 1;
    return 0;
  }
};

int main(int argc, char ** argv) {
  try {
    if (argc != 2) throw std::runtime_error("usage: rpp_goal_rotation nav2.yaml");
    const auto c = YAML::LoadFile(argv[1])["controller_server"]["ros__parameters"];
    auto old = YAML::Clone(c);
    old["FollowPath"]["min_lookahead_dist"] = 0.22;
    old["goal_checker"]["xy_goal_tolerance"] = 0.25;
    Probe broken(old);
    if (broken.mode(5.0, 0.0, 0.0) != 2)
      throw std::runtime_error("Installed plugin did not reproduce old premature final rotation");
    std::cout << "REPRODUCED: old config chooses FINAL ROTATION on a 5 m forward path\n";
    Probe fixed(c);
    int cases = 0;
    const double threshold = c["FollowPath"]["rotate_to_heading_min_angle"].as<double>();
    for (double speed : {0.0, 0.05, 0.2, 0.6, 0.8}) {
      for (double angle : {-3.0, -1.6, -0.4, 0.0, 0.4, 1.6, 3.0}) {
        for (double distance : {0.4, 1.0, 5.0}) {
          const int expected = std::abs(angle) > threshold ? 1 : 0;
          if (fixed.mode(distance, angle, speed) != expected)
            throw std::runtime_error("Wrong mode away from goal; speed=" + std::to_string(speed));
          ++cases;
        }
      }
    }
    if (fixed.mode(0.1, 0.0, 0.0) != 2)
      throw std::runtime_error("Final rotation no longer works near goal");
    std::cout << "PASS: " << cases << " path cases; final rotation retained at 0.1 m\n";
  } catch (const std::exception & e) {
    std::cerr << e.what() << '\n';
    return 1;
  }
}
