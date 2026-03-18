-- MySQL dump 10.13  Distrib 8.0.45, for Linux (x86_64)
--
-- Host: localhost    Database: goatbot
-- ------------------------------------------------------
-- Server version	8.0.45-0ubuntu0.24.04.1

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `active_effects`
--

DROP TABLE IF EXISTS `active_effects`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `active_effects` (
  `id` int NOT NULL AUTO_INCREMENT,
  `psid` varchar(50) NOT NULL,
  `effect_type` varchar(50) NOT NULL,
  `effect_value` int DEFAULT '0',
  `uses_left` int DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `idx_psid` (`psid`)
) ENGINE=InnoDB AUTO_INCREMENT=47 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `active_effects`
--

LOCK TABLES `active_effects` WRITE;
/*!40000 ALTER TABLE `active_effects` DISABLE KEYS */;
INSERT INTO `active_effects` VALUES (2,'100078278904731','protect_rob',50,2),(6,'100084580821825','protect_rob',70,18),(24,'100084580821825','bet_refund',30,3),(32,'61573185174401','work_bonus',50,2),(33,'61573185174401','luck',8,1),(34,'61582269217716','protect_rob',50,2),(38,'100021860140012','work_bonus',50,3),(39,'100021860140012','luck',8,4);
/*!40000 ALTER TABLE `active_effects` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bank_accounts`
--

DROP TABLE IF EXISTS `bank_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bank_accounts` (
  `psid` varchar(50) NOT NULL,
  `balance` bigint DEFAULT '0',
  `last_bank_check` timestamp NULL DEFAULT NULL,
  `last_deposit` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`psid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bank_accounts`
--

LOCK TABLES `bank_accounts` WRITE;
/*!40000 ALTER TABLE `bank_accounts` DISABLE KEYS */;
INSERT INTO `bank_accounts` VALUES ('100051105791524',6905126,'2026-02-26 19:05:36','2026-02-26 17:06:37'),('100072808561028',96,'2026-02-26 15:34:52','2026-02-26 15:08:39'),('100084580821825',100000,'2026-02-21 17:13:17','2026-02-26 15:12:04'),('61559693883903',3600000,'2026-02-21 18:07:57','2026-02-21 18:07:46'),('61575865269665',727133,'2026-02-21 17:08:30','2026-02-21 16:28:38');
/*!40000 ALTER TABLE `bank_accounts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bank_loans`
--

DROP TABLE IF EXISTS `bank_loans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bank_loans` (
  `psid` varchar(50) NOT NULL,
  `principal` bigint NOT NULL,
  `interest_rate` float NOT NULL,
  `taken_at` timestamp NOT NULL,
  `last_loan_check` timestamp NULL DEFAULT NULL,
  `due_days` int NOT NULL,
  `is_overdue` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`psid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bank_loans`
--

LOCK TABLES `bank_loans` WRITE;
/*!40000 ALTER TABLE `bank_loans` DISABLE KEYS */;
INSERT INTO `bank_loans` VALUES ('100042777941607',1000000,0.075,'2026-02-20 16:31:16','2026-02-20 16:31:16',7,0),('100072808561028',600000,0.075,'2026-02-20 16:31:39','2026-02-20 16:31:39',8,0),('100073467514047',1000000,0.075,'2026-02-22 06:39:29','2026-02-22 06:39:29',7,0),('100078278904731',1000000,0.075,'2026-02-20 16:34:20','2026-02-20 16:34:20',7,0),('100093233703693',500000,0.075,'2026-02-20 17:08:55','2026-02-22 04:52:05',2,0),('61573185174401',1000000,0.075,'2026-02-22 06:17:16','2026-02-22 06:17:16',7,0),('61582269217716',1000000,0.075,'2026-02-22 06:44:02','2026-02-22 06:44:02',7,0);
/*!40000 ALTER TABLE `bank_loans` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bank_pool`
--

DROP TABLE IF EXISTS `bank_pool`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bank_pool` (
  `id` int NOT NULL DEFAULT '1',
  `total_balance` bigint NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bank_pool`
--

LOCK TABLES `bank_pool` WRITE;
/*!40000 ALTER TABLE `bank_pool` DISABLE KEYS */;
INSERT INTO `bank_pool` VALUES (1,0);
/*!40000 ALTER TABLE `bank_pool` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `messenger_user_credits`
--

DROP TABLE IF EXISTS `messenger_user_credits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `messenger_user_credits` (
  `id` int NOT NULL AUTO_INCREMENT,
  `psid` varchar(50) NOT NULL,
  `threadID` varchar(50) NOT NULL,
  `credits` bigint DEFAULT '10000',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_user_thread` (`psid`,`threadID`),
  KEY `idx_threadID` (`threadID`),
  KEY `idx_psid` (`psid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `messenger_user_credits`
--

LOCK TABLES `messenger_user_credits` WRITE;
/*!40000 ALTER TABLE `messenger_user_credits` DISABLE KEYS */;
/*!40000 ALTER TABLE `messenger_user_credits` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `messenger_users`
--

DROP TABLE IF EXISTS `messenger_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `messenger_users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `psid` varchar(50) NOT NULL,
  `name` varchar(100) DEFAULT NULL,
  `credits` bigint DEFAULT '0',
  `last_checkin` date DEFAULT NULL,
  `vip_until` timestamp NULL DEFAULT NULL,
  `games_played` int DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `psid` (`psid`)
) ENGINE=InnoDB AUTO_INCREMENT=30 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `messenger_users`
--

LOCK TABLES `messenger_users` WRITE;
/*!40000 ALTER TABLE `messenger_users` DISABLE KEYS */;
INSERT INTO `messenger_users` VALUES (1,'100037351338722','Lê Văn',100002146950,NULL,NULL,0),(2,'100042777941607','Nguyễn H.Hoàng',81963,'2026-02-21',NULL,20),(3,'100078278904731','Hùng Ph',0,NULL,NULL,21),(4,'100085042345599','Linh Trang',75676,NULL,NULL,0),(5,'61573185174401','Nam Thanh',0,'2026-02-22',NULL,4),(6,'100021860140012','Ngô Nguyênn',-21573,'2026-02-26','2026-02-22 11:46:40',10),(7,'100072808561028','Nguyen Anh',46604,'2026-02-26',NULL,7),(8,'100093233703693','Nguyễn Hữu Thành',-14732,'2026-02-22',NULL,6),(9,'100084580821825','Văn Hiền',27234,'2026-02-26','2026-03-24 15:20:34',87),(10,'100089799889841','Nguyễn Quân',0,NULL,NULL,10),(11,'100009869389207','Phạm Hoàng',49910,'2026-02-21',NULL,0),(12,'61559693883903','Phạm Thái Bình',3704113,'2026-02-27','2026-02-27 22:23:39',26),(13,'100050434177524','Trương Việt Quang',132698,'2026-02-21',NULL,0),(14,'100093660381660','Đặng Quang',26840,'2026-02-22',NULL,0),(15,'100017568846689','Máy Dập Đất Nam',521110,NULL,'2026-02-23 17:04:32',0),(16,'100084823731194','Lê Bảo',84480,NULL,NULL,2),(17,'100051105791524','Trần Phong',1333566,'2026-02-27','2026-02-27 15:28:46',12),(18,'61575865269665','Tiến Đạt',97517,'2026-02-26','2026-02-22 16:14:39',29),(19,'61555480733864','Sunny Cat',-16352,NULL,NULL,0),(20,'61588171380707','Ngoc Chi',1218646,'2026-02-22',NULL,0),(21,'100007862685839','Huy Nguyễn',134455,'2026-02-26',NULL,3),(22,'61588163755242','Bun Yeu',569864,'2026-02-22',NULL,0),(23,'61585254845340','Nguyễn Hồng Kỳ',57015,'2026-02-22',NULL,0),(24,'100069837410483','Quôc Bảo',10000,NULL,NULL,0),(25,'100073467514047','Thanh Nam',0,'2026-02-22',NULL,3),(26,'100080633727486','Phạm Minh',45584,'2026-02-22',NULL,0),(27,'61582269217716','Ngọc Nhi',2303529,'2026-02-22',NULL,4),(28,'100087765207133','Vinh Hoàng',-90879,'2026-02-26',NULL,2),(29,'100060030997586','Ng Ngọc Huy',10000,NULL,NULL,0);
/*!40000 ALTER TABLE `messenger_users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `shop_items`
--

DROP TABLE IF EXISTS `shop_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `shop_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_key` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `price` bigint NOT NULL,
  `type` varchar(50) NOT NULL,
  `effect_value` int DEFAULT '0',
  `uses` int DEFAULT '1',
  `stackable` tinyint(1) DEFAULT '1',
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `item_key` (`item_key`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `shop_items`
--

LOCK TABLES `shop_items` WRITE;
/*!40000 ALTER TABLE `shop_items` DISABLE KEYS */;
INSERT INTO `shop_items` VALUES (1,'khien','Khiên chống cướp',200000,'protect_rob',50,2,1,'Đỡ 2 lần cướp, giảm 50% thành công','2026-02-11 14:20:08'),(2,'khienvip','Khiên xịn',800000,'protect_rob',70,5,1,'Đỡ 5 lần cướp, giảm 70%','2026-02-11 14:20:08'),(3,'lucky','Bùa may',150000,'luck',8,5,1,'+8% tỉ lệ thắng trong 5 game','2026-02-11 14:20:08'),(4,'bh','Bảo hiểm',100000,'bet_refund',30,3,1,'Hoàn 30% tiền thua trong 3 lần','2026-02-11 14:20:08'),(5,'gangtay','Găng tay',100000,'work_bonus',50,3,1,'+50% tiền work trong 3 lần','2026-02-11 14:20:08'),(6,'box','Hộp bí ẩn',20000,'lootbox',0,1,1,'Mở ra random tiền/item','2026-02-11 14:20:08'),(7,'vip1','VIP 1 ngày',300000,'vip',1,1,1,'Quyền lợi VIP trong 1 ngày','2026-02-11 14:37:20'),(8,'vip7','VIP 7 ngày',1800000,'vip',7,1,1,'Quyền lợi VIP trong 7 ngày','2026-02-11 14:37:20'),(9,'vip15','VIP 15 ngày',4000000,'vip',15,1,1,'Quyền lợi VIP trong 15 ngày','2026-02-11 14:37:20'),(10,'vip30','VIP 30 ngày',10000000,'vip',30,1,1,'Quyền lợi VIP trong 30 ngày','2026-02-11 14:37:20');
/*!40000 ALTER TABLE `shop_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `transfer_limits`
--

DROP TABLE IF EXISTS `transfer_limits`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `transfer_limits` (
  `psid` varchar(50) NOT NULL,
  `transferred_today` bigint DEFAULT '0',
  `last_reset` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`psid`),
  KEY `idx_transfer_reset` (`last_reset`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `transfer_limits`
--

LOCK TABLES `transfer_limits` WRITE;
/*!40000 ALTER TABLE `transfer_limits` DISABLE KEYS */;
/*!40000 ALTER TABLE `transfer_limits` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_inventory`
--

DROP TABLE IF EXISTS `user_inventory`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_inventory` (
  `id` int NOT NULL AUTO_INCREMENT,
  `psid` varchar(50) NOT NULL,
  `item_key` varchar(50) NOT NULL,
  `uses_left` int DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_psid` (`psid`),
  KEY `idx_item` (`item_key`)
) ENGINE=InnoDB AUTO_INCREMENT=37 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_inventory`
--

LOCK TABLES `user_inventory` WRITE;
/*!40000 ALTER TABLE `user_inventory` DISABLE KEYS */;
INSERT INTO `user_inventory` VALUES (2,'100078278904731','khien',1,'2026-02-20 16:36:07'),(3,'100072808561028','khien',2,'2026-02-20 18:32:08'),(5,'100021860140012','lucky',3,'2026-02-21 11:47:26'),(10,'61559693883903','gangtay',3,'2026-02-21 15:17:49'),(12,'100017568846689','box',1,'2026-02-21 16:09:12'),(13,'100084580821825','khienvip',9,'2026-02-21 16:09:27'),(15,'61575865269665','gangtay',4,'2026-02-21 16:15:46'),(17,'100017568846689','khiên',4,'2026-02-21 16:52:55'),(18,'100084580821825','bh',2,'2026-02-21 16:55:03'),(19,'100084580821825','khien',1,'2026-02-21 16:55:15'),(21,'61575865269665','lucky',9,'2026-02-21 16:55:48'),(30,'61588171380707','box',2,'2026-02-22 03:47:34'),(32,'61573185174401','gangtay',4,'2026-02-22 06:18:44'),(33,'61573185174401','lucky',8,'2026-02-22 06:19:04'),(35,'61582269217716','khien',1,'2026-02-22 06:48:12'),(36,'100042777941607','gangtay',8,'2026-02-26 15:51:23');
/*!40000 ALTER TABLE `user_inventory` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_jail`
--

DROP TABLE IF EXISTS `user_jail`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_jail` (
  `psid` varchar(50) NOT NULL,
  `jail_until` timestamp NOT NULL,
  `reason` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`psid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_jail`
--

LOCK TABLES `user_jail` WRITE;
/*!40000 ALTER TABLE `user_jail` DISABLE KEYS */;
INSERT INTO `user_jail` VALUES ('100009869389207','2026-02-21 03:38:41','Cướp fail'),('100017568846689','2026-02-21 20:26:15','Cướp fail'),('100021860140012','2026-02-22 05:05:33','Cướp fail'),('100042777941607','2026-02-26 15:12:16','Cướp fail'),('100050434177524','2026-02-21 17:20:11','Cướp fail'),('100051105791524','2026-02-21 16:44:09','Cướp fail'),('100072808561028','2026-02-26 15:49:49','Cướp fail'),('100078278904731','2026-02-21 18:41:42','Cướp fail'),('100084580821825','2026-02-26 15:20:18','Cướp fail'),('100085042345599','2026-02-20 15:58:40','Cướp fail'),('100087765207133','2026-02-26 14:59:22','Cướp fail'),('100089799889841','2026-02-20 18:33:46','Cướp fail'),('61559693883903','2026-02-26 23:35:43','Cướp fail'),('61573185174401','2026-02-20 18:16:57','Cướp fail'),('61575865269665','2026-02-21 19:43:06','Cướp fail'),('61588163755242','2026-02-22 03:53:35','Cướp fail'),('61588171380707','2026-02-22 04:01:59','Cướp fail');
/*!40000 ALTER TABLE `user_jail` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-02-27  7:20:31
